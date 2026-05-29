import { describe, expect, it } from "bun:test";
import { SmithError } from "../../src/core/smith-error";
import {
  atlassianFetch,
  createRequestBudget,
  errorBodySnippet,
  isAbortError,
  remediationNotConfigured,
} from "../../src/io/atlassian-http";
import { fetchConfluencePages } from "../../src/io/confluence";

function mockResponse(init: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const responseInit: ResponseInit = { status: init.status };
  if (init.headers) responseInit.headers = init.headers;
  return new Response(init.body ?? "", responseInit);
}

describe("errorBodySnippet", () => {
  it("returns parenthesized trimmed snippet for non-empty body", async () => {
    const res = mockResponse({ status: 500, body: "  internal error  " });
    expect(await errorBodySnippet(res)).toBe(" (internal error)");
  });

  it("returns empty string for empty body", async () => {
    const res = mockResponse({ status: 500, body: "" });
    expect(await errorBodySnippet(res)).toBe("");
  });

  it("truncates body at 200 chars", async () => {
    const long = "x".repeat(500);
    const res = mockResponse({ status: 500, body: long });
    const snippet = await errorBodySnippet(res);
    expect(snippet).toBe(` (${"x".repeat(200)})`);
  });
});

describe("remediationNotConfigured", () => {
  it("includes the env-var names and the API token URL", () => {
    const msg = remediationNotConfigured();
    expect(msg).toContain("SMITH_ATLASSIAN_EMAIL");
    expect(msg).toContain("SMITH_ATLASSIAN_API_TOKEN");
    expect(msg).toContain("https://id.atlassian.com/manage-profile/security/api-tokens");
  });

  it("interpolates the resolved stateHome() for the .env path", () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-remediation-test";
    try {
      expect(remediationNotConfigured()).toContain("/tmp/xdg-remediation-test/agent-smith/.env");
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

describe("atlassianFetch (behavior-preserving wrapper)", () => {
  it("returns 2xx without retry", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return mockResponse({ status: 200, body: "ok" });
    }) as unknown as typeof fetch;
    const res = await atlassianFetch("https://example.invalid/x", {}, fakeFetch);
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("retries once on 429 honoring Retry-After capped at 30s", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return mockResponse({ status: 429, headers: { "retry-after": "0" } });
      }
      return mockResponse({ status: 200, body: "ok" });
    }) as unknown as typeof fetch;
    const res = await atlassianFetch("https://example.invalid/x", {}, fakeFetch);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe("atlassianFetch retry/backoff (Task 2)", () => {
  function recordSleeps(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    return { sleeps, sleep };
  }

  it("retries 429 up to 4 attempts total then throws rate-limited error", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 429, headers: { "retry-after": "0" } });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload1 = (caught as SmithError).payload;
    expect(payload1.code).toBe("http-error");
    if (payload1.code === "http-error") {
      expect(payload1.status).toBe(429);
      expect(payload1.operation).toContain("rate-limited after 4 attempts");
    }
    expect(calls).toBe(4);
    expect(sleeps.length).toBe(3);
  });

  it("retries 502/503/504 with exponential backoff 500/1000/2000 ms and full jitter", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 503, body: "down" });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload2 = (caught as SmithError).payload;
    expect(payload2.code).toBe("http-error");
    if (payload2.code === "http-error") {
      expect(payload2.status).toBe(503);
      expect(payload2.operation).toContain("unavailable after 4 attempts");
    }
    expect(calls).toBe(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it("redacts URL credentials in rate-limit-exhausted (429) error payload", async () => {
    const fakeFetch: typeof fetch = (async () =>
      mockResponse({ status: 429, headers: { "retry-after": "0" } })) as unknown as typeof fetch;
    const { sleep } = recordSleeps();
    let caught: unknown;
    try {
      await atlassianFetch("https://user:secret@example.invalid/api/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("http-error");
    if (payload.code === "http-error") {
      expect(payload.url).not.toContain("user:secret@");
      expect(payload.url).not.toContain("secret");
    }
  });

  it("redacts URL query secrets in unavailable-exhausted (5xx) error payload", async () => {
    const fakeFetch: typeof fetch = (async () =>
      mockResponse({ status: 503, body: "down" })) as unknown as typeof fetch;
    const { sleep } = recordSleeps();
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/api/x?token=hunter2", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("http-error");
    if (payload.code === "http-error") {
      expect(payload.url).not.toContain("hunter2");
      expect(payload.url).toContain("token=[redacted]");
    }
  });

  it("does NOT retry 500 (deterministic server bug, not transient)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 500, body: "boom" });
    }) as unknown as typeof fetch;
    const { sleep } = recordSleeps();
    const res = await atlassianFetch("https://example.invalid/x", {}, fakeFetch, { sleep });
    expect(res.status).toBe(500);
    expect(calls).toBe(1);
  });

  it("applies full jitter to backoff with random=0 (half of base)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 503 });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0,
      });
    } catch {
      // expected
    }
    expect(sleeps).toEqual([250, 500, 1000]);
  });

  it("honors Retry-After (seconds) capped at 30s and jittered", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 429, headers: { "retry-after": "60" } });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch {
      // expected
    }
    expect(sleeps).toEqual([30_000, 30_000, 30_000]);
  });

  it("Retry-After absent uses 1s base (jittered)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 429 });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
      });
    } catch {
      // expected
    }
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it("succeeds on the 3rd attempt and returns 200 (no error)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      if (calls < 3) return mockResponse({ status: 503 });
      return mockResponse({ status: 200, body: "ok" });
    }) as unknown as typeof fetch;
    const { sleeps, sleep } = recordSleeps();
    const res = await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
      sleep,
      random: () => 0.5,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("propagates caller AbortError unchanged (caller signal aborted)", async () => {
    const controller = new AbortController();
    const fakeFetch: typeof fetch = (async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        signal: controller.signal,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });

  it("converts internal-timeout abort to a descriptive Error with 30s in the message", async () => {
    const fakeFetch: typeof fetch = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload3 = (caught as SmithError).payload;
    expect(payload3.code).toBe("validation-failed");
    if (payload3.code === "validation-failed") {
      expect(payload3.reasons.join(" ")).toContain("timed out after 30s");
    }
  });

  it("throws wall-clock-budget error when cumulative time exceeds 90s", async () => {
    let calls = 0;
    let now = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      now += 50_000;
      return mockResponse({ status: 503 });
    }) as unknown as typeof fetch;
    const sleep = async (_ms: number) => {
      // sleeps don't advance our injected clock; only the fetch does
    };
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep,
        random: () => 0.5,
        now: () => now,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload4 = (caught as SmithError).payload;
    expect(payload4.code).toBe("validation-failed");
    if (payload4.code === "validation-failed") {
      expect(payload4.reasons.join(" ")).toContain("exceeded 90s");
    }
    expect(calls).toBe(2);
  });
});

describe("atlassianFetch auth classification (Task 3)", () => {
  it("throws SmithError(permission-denied) on 401", async () => {
    const fakeFetch: typeof fetch = (async () =>
      mockResponse({ status: 401, body: "unauthorized" })) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("permission-denied");
  });

  it("throws SmithError(permission-denied) on 403", async () => {
    const fakeFetch: typeof fetch = (async () =>
      mockResponse({ status: 403 })) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("permission-denied");
  });

  it("does NOT retry 401/403 (no sleep called)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 401 });
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
    } catch {
      // expected
    }
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe("createRequestBudget", () => {
  it("allows up to N consume() calls then throws", () => {
    const b = createRequestBudget(3);
    b.consume();
    b.consume();
    b.consume();
    let caught: unknown;
    try {
      b.consume();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload5 = (caught as SmithError).payload;
    expect(payload5.code).toBe("validation-failed");
    if (payload5.code === "validation-failed") {
      expect(payload5.reasons.join(" ")).toContain("3-request budget");
    }
  });

  it("defaults to 200", () => {
    const b = createRequestBudget();
    for (let i = 0; i < 200; i++) b.consume();
    let caught: unknown;
    try {
      b.consume();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload6 = (caught as SmithError).payload;
    expect(payload6.code).toBe("validation-failed");
    if (payload6.code === "validation-failed") {
      expect(payload6.reasons.join(" ")).toContain("200-request budget");
    }
  });
});

describe("atlassianFetch budget consumption", () => {
  it("consumes one budget unit per request (including retries)", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      if (calls < 3) return mockResponse({ status: 503 });
      return mockResponse({ status: 200, body: "ok" });
    }) as unknown as typeof fetch;
    const budget = createRequestBudget(10);
    let consumed = 0;
    const wrapped = {
      consume: () => {
        consumed += 1;
        budget.consume();
      },
    };
    const res = await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
      budget: wrapped,
      sleep: async () => {},
      random: () => 0.5,
    });
    expect(res.status).toBe(200);
    expect(consumed).toBe(3);
  });

  it("throws budget error if budget exhausted before next attempt", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async () => {
      calls += 1;
      return mockResponse({ status: 503 });
    }) as unknown as typeof fetch;
    const budget = createRequestBudget(2);
    let caught: unknown;
    try {
      await atlassianFetch("https://example.invalid/x", {}, fakeFetch, {
        budget,
        sleep: async () => {},
        random: () => 0.5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload7 = (caught as SmithError).payload;
    expect(payload7.code).toBe("validation-failed");
    if (payload7.code === "validation-failed") {
      expect(payload7.reasons.join(" ")).toContain("2-request budget");
    }
    expect(calls).toBe(2);
  });
});

describe("Confluence threads request budget through walks", () => {
  it("budget tracks every helper-call across a small walk", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async (url: string) => {
      calls += 1;
      const u = String(url);
      if (u.includes("/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "100", key: "ENG" }] }), {
          status: 200,
        });
      }
      if (u.includes("/spaces/100/pages")) {
        return new Response(JSON.stringify({ results: [{ id: "1", title: "p" }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ id: "1", title: "p", body: { storage: { value: "<p>hi</p>" } } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const result = await fetchConfluencePages({
      space: "ENG",
      maxPages: 1,
      resolveAuth: () => ({ email: "e@x", token: "t", source: "env-smith" }),
      env: { SMITH_ATLASSIAN_BASE_URL: "https://example.atlassian.net" } as NodeJS.ProcessEnv,
      fetch: fakeFetch,
    });
    expect(result.artifacts.length).toBe(1);
    expect(calls).toBe(3);
  });
});

describe("isAbortError predicate (cross-runtime contract)", () => {
  it("returns true for DOMException with name AbortError", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("returns true for Error with name AbortError", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });

  it("returns false for plain Error (guards against over-broad matching)", () => {
    expect(isAbortError(new Error("nope"))).toBe(false);
  });
});
