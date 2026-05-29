import { describe, expect, test } from "bun:test";
import {
  formatHeadline,
  formatRemediation,
  SmithError,
  type SmithErrorPayload,
} from "../../src/core/smith-error";

describe("SmithError class", () => {
  test("extends Error and carries payload", () => {
    const payload: SmithErrorPayload = {
      code: "registry-version",
      current: 99,
      expected: 1,
      path: "/tmp/registry.json",
    };
    const err = new SmithError(payload);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.name).toBe("SmithError");
    expect(err.payload).toBe(payload);
    expect(err.code).toBe("registry-version");
  });

  test("message is the headline", () => {
    const err = new SmithError({
      code: "usage-error",
      message: "missing --label",
    });
    expect(err.message).toContain("missing --label");
  });

  test("preserves cause when provided", () => {
    const cause = new Error("underlying");
    const err = new SmithError(
      { code: "registry-corrupt-json", path: "/tmp/r.json", parseError: "x" },
      { cause },
    );
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  test("payload narrows by code", () => {
    const err = new SmithError({
      code: "validation-failed",
      what: "agent catalog",
      reasons: ["a", "b"],
    });
    if (err.payload.code === "validation-failed") {
      // Runtime + type-level narrowing check. The `reasons`/`what` accesses
      // are exclusive to this variant; if narrowing breaks (e.g. payload
      // becomes `any`), those accesses still compile, so the runtime guard
      // alone doesn't prove the type system did its job.
      expect(err.payload.reasons).toEqual(["a", "b"]);
      expect(err.payload.what).toBe("agent catalog");
    } else {
      // The else branch narrows to all NON-validation-failed variants; none
      // of them have `reasons`. If discriminated narrowing breaks, the
      // directive below stops being needed and tsc fails this file.
      // @ts-expect-error - reasons must not exist on non-validation payloads
      err.payload.reasons;
      throw new Error("payload did not narrow to validation-failed");
    }
  });
});

describe("formatHeadline", () => {
  test("registry-version", () => {
    expect(formatHeadline({ code: "registry-version", current: 99, expected: 1, path: "/x" })).toBe(
      "agent catalog file version mismatch",
    );
  });

  test("registry-corrupt-json", () => {
    expect(formatHeadline({ code: "registry-corrupt-json", path: "/x", parseError: "y" })).toBe(
      "agent catalog file is corrupt",
    );
  });

  test("skill-registry-version", () => {
    expect(
      formatHeadline({ code: "skill-registry-version", current: 2, expected: 1, path: "/x" }),
    ).toBe("skill catalog file version mismatch");
  });

  test("installed-skills-corrupt", () => {
    expect(formatHeadline({ code: "installed-skills-corrupt", path: "/x", parseError: "y" })).toBe(
      "installed-skills state file is corrupt",
    );
  });

  test("config-missing", () => {
    expect(
      formatHeadline({ code: "config-missing", path: "/x", suggestedCommand: "smith init" }),
    ).toBe("config file missing");
  });

  test("permission-denied (read)", () => {
    expect(formatHeadline({ code: "permission-denied", path: "/x", operation: "read" })).toBe(
      "permission denied",
    );
  });

  test("usage-error uses the message", () => {
    expect(formatHeadline({ code: "usage-error", message: "missing --label" })).toBe(
      "missing --label",
    );
  });

  test("validation-failed includes the 'what'", () => {
    expect(
      formatHeadline({
        code: "validation-failed",
        what: "agent catalog",
        reasons: ["empty"],
      }),
    ).toBe("agent catalog validation failed");
  });

  test("partial-failure summarizes counts", () => {
    expect(
      formatHeadline({
        code: "partial-failure",
        operation: "agent uninstall-all",
        succeeded: 3,
        failed: 1,
        skipped: 0,
        details: ["a", "b"],
      }),
    ).toBe("agent uninstall-all completed with errors");
  });

  test("not-found renders as '<what> not found: <identifier>'", () => {
    expect(
      formatHeadline({
        code: "not-found",
        what: "agent catalog",
        identifier: "/foo/bar",
      }),
    ).toBe("agent catalog not found: /foo/bar");
  });

  test("already-exists renders as '<what> already exists: <identifier>'", () => {
    expect(
      formatHeadline({
        code: "already-exists",
        what: "agent",
        identifier: "example-agent",
      }),
    ).toBe("agent already exists: example-agent");
  });

  test("http-error with operation renders '<service> <operation>: HTTP <status>'", () => {
    expect(
      formatHeadline({
        code: "http-error",
        service: "Confluence",
        status: 503,
        url: "https://example.atlassian.net/x",
        operation: "GET page",
      }),
    ).toBe("Confluence GET page: HTTP 503");
  });

  test("http-error without operation renders '<service>: HTTP <status>'", () => {
    expect(
      formatHeadline({
        code: "http-error",
        service: "fetch",
        status: 404,
        url: "https://example.com/missing",
      }),
    ).toBe("fetch: HTTP 404");
  });
});

describe("SmithError http-error variant", () => {
  test("payload narrows to http-error and carries all fields", () => {
    const err = new SmithError({
      code: "http-error",
      service: "Jira",
      status: 500,
      url: "https://example.atlassian.net/rest/api/3/search/jql",
      operation: "search issues",
      snippet: "internal server error",
    });
    expect(err).toBeInstanceOf(SmithError);
    expect(err.code).toBe("http-error");
    if (err.payload.code === "http-error") {
      expect(err.payload.service).toBe("Jira");
      expect(err.payload.status).toBe(500);
      expect(err.payload.url).toBe("https://example.atlassian.net/rest/api/3/search/jql");
      expect(err.payload.operation).toBe("search issues");
      expect(err.payload.snippet).toBe("internal server error");
    } else {
      throw new Error("payload did not narrow to http-error");
    }
  });
});

describe("formatRemediation", () => {
  test("registry-version: 3-step bullet list", () => {
    const out = formatRemediation({
      code: "registry-version",
      current: 99,
      expected: 1,
      path: "/Users/me/.config/agent-smith/registry.json",
    });
    expect(out).toContain("This file was written by a different version");
    expect(out).toContain("1. Move the file aside:");
    expect(out).toContain("mv /Users/me/.config/agent-smith/registry.json");
    expect(out).toContain("2. Re-initialize:");
    expect(out).toContain("smith init");
    expect(out).toContain("3. Re-register external catalogs:");
  });

  test("registry-corrupt-json: 2-step alternative", () => {
    const out = formatRemediation({
      code: "registry-corrupt-json",
      path: "/p/registry.json",
      parseError: "Unexpected token",
    });
    expect(out).toContain("not valid JSON");
    expect(out).toContain("Fix the JSON syntax manually");
    expect(out).toContain("Move it aside:");
    expect(out).toContain("smith init");
  });

  test("skill-registry-version: 3-step bullet list", () => {
    const out = formatRemediation({
      code: "skill-registry-version",
      current: 9,
      expected: 1,
      path: "/p/skill-catalogs.json",
    });
    expect(out).toContain("Move the file aside");
    expect(out).toContain("smith init");
    expect(out).toContain("smith skill register");
  });

  test("installed-skills-corrupt: single-command recovery", () => {
    const out = formatRemediation({
      code: "installed-skills-corrupt",
      path: "/p/installed-skills.json",
      parseError: "x",
    });
    expect(out).toContain("rm /p/installed-skills.json");
    expect(out).toContain("smith skill install");
  });

  test("config-missing uses suggestedCommand", () => {
    const out = formatRemediation({
      code: "config-missing",
      path: "/p/USER.md",
      suggestedCommand: "smith init-user",
    });
    expect(out).toContain("smith init-user");
  });

  test("permission-denied includes operation + path", () => {
    const out = formatRemediation({
      code: "permission-denied",
      path: "/p",
      operation: "write",
    });
    expect(out).toContain("/p");
    expect(out).toContain("write");
  });

  test("usage-error with suggestedCommand renders Try line", () => {
    const out = formatRemediation({
      code: "usage-error",
      message: "missing --label",
      suggestedCommand: "smith agent register /tmp --label foo",
    });
    expect(out).toContain("Try: smith agent register /tmp --label foo");
  });

  test("usage-error without suggestedCommand renders empty", () => {
    const out = formatRemediation({
      code: "usage-error",
      message: "missing --label",
    });
    expect(out).toBe("");
  });

  test("validation-failed with suggestedCommand renders Try line", () => {
    const out = formatRemediation({
      code: "validation-failed",
      what: "agent catalog",
      reasons: ["empty"],
      suggestedCommand: "smith agent register /tmp --allow-empty",
    });
    expect(out).toContain("Try: smith agent register /tmp --allow-empty");
  });

  test("validation-failed without suggestedCommand renders empty", () => {
    const out = formatRemediation({
      code: "validation-failed",
      what: "agent catalog",
      reasons: ["empty"],
    });
    expect(out).toBe("");
  });

  test("partial-failure renders empty (details go in body)", () => {
    expect(
      formatRemediation({
        code: "partial-failure",
        operation: "agent uninstall-all",
        succeeded: 1,
        failed: 1,
        skipped: 0,
        details: ["a"],
      }),
    ).toBe("");
  });

  test("not-found returns suggestedCommand when present", () => {
    expect(
      formatRemediation({
        code: "not-found",
        what: "skill",
        identifier: "team/the-architect",
        suggestedCommand: "smith skill list",
      }),
    ).toBe("Try: smith skill list");
  });

  test("not-found returns empty string without suggestedCommand", () => {
    expect(
      formatRemediation({
        code: "not-found",
        what: "skill",
        identifier: "team/the-architect",
      }),
    ).toBe("");
  });

  test("already-exists returns suggestedCommand when present", () => {
    expect(
      formatRemediation({
        code: "already-exists",
        what: "agent",
        identifier: "example-agent",
        suggestedCommand: "smith agent destroy example-agent",
      }),
    ).toBe("Try: smith agent destroy example-agent");
  });

  test("already-exists returns empty string without suggestedCommand", () => {
    expect(
      formatRemediation({
        code: "already-exists",
        what: "agent",
        identifier: "example-agent",
      }),
    ).toBe("");
  });

  test("http-error 5xx hints at server error", () => {
    const out = formatRemediation({
      code: "http-error",
      service: "Confluence",
      status: 503,
      url: "https://example.com/x",
    });
    expect(out).toContain("server returned an error");
  });

  test("http-error 4xx hints at request well-formed", () => {
    const out = formatRemediation({
      code: "http-error",
      service: "fetch",
      status: 404,
      url: "https://example.com/x",
    });
    expect(out).toContain("Verify the request is well-formed");
  });

  test("network-error remediation mentions connectivity + redaction", () => {
    const out = formatRemediation({
      code: "network-error",
      operation: "fetch",
      url: "https://example.com/x",
      cause: "ECONNREFUSED",
    });
    expect(out).toContain("connectivity");
    expect(out).toContain("redacted");
  });
});

describe("formatHeadline — network-error", () => {
  test("network-error renders '<operation> failed: network error'", () => {
    expect(
      formatHeadline({
        code: "network-error",
        operation: "fetch",
        url: "https://example.com/x",
        cause: "ECONNREFUSED",
      }),
    ).toBe("fetch failed: network error");
  });
});

describe("SmithError network-error variant", () => {
  test("payload narrows to network-error and carries all fields", () => {
    const err = new SmithError({
      code: "network-error",
      operation: "fetch",
      url: "https://api.example.com/v1?api_key=[redacted]",
      cause: "fetch failed: ECONNREFUSED",
    });
    expect(err).toBeInstanceOf(SmithError);
    expect(err.code).toBe("network-error");
    if (err.payload.code === "network-error") {
      expect(err.payload.operation).toBe("fetch");
      expect(err.payload.url).toBe("https://api.example.com/v1?api_key=[redacted]");
      expect(err.payload.cause).toBe("fetch failed: ECONNREFUSED");
    } else {
      throw new Error("payload did not narrow to network-error");
    }
  });
});
