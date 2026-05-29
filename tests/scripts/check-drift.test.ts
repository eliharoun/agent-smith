import { describe, expect, test } from "bun:test";
import { runCheckDrift, runCheckKiroDrift } from "../../scripts/check-drift";

describe("runCheckDrift", () => {
  test("no-drift case → exit 0, message 'OpenCode schema unchanged...'", async () => {
    const vendored = { properties: { agent: { type: "object" } } };
    let stdout = "";
    const code = await runCheckDrift({
      vendored,
      fetch: async () => new Response(JSON.stringify(vendored)),
      print: (s) => {
        stdout += `${s}\n`;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("unchanged");
    expect(stdout).toContain("2026-05-01");
  });

  test("drift case → exit 1, prints structural diff paths", async () => {
    const vendored = { properties: { agent: { type: "object" } } };
    const live = { properties: { agent: { type: "object", new: 1 } } };
    let stdout = "";
    const code = await runCheckDrift({
      vendored,
      fetch: async () => new Response(JSON.stringify(live)),
      print: (s) => {
        stdout += `${s}\n`;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(1);
    expect(stdout).toContain("DRIFT");
    expect(stdout).toContain("properties/agent/new");
  });

  test("network failure → exit 2", async () => {
    let stderr = "";
    const code = await runCheckDrift({
      vendored: {},
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      print: () => {},
      printErr: (s) => {
        stderr += s;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(2);
    expect(stderr).toContain("ECONNREFUSED");
  });

  test("non-200 HTTP response → exit 2, stderr 'HTTP <status>'", async () => {
    let stderr = "";
    const code = await runCheckDrift({
      vendored: {},
      fetch: async () => new Response("not found", { status: 404 }),
      print: () => {},
      printErr: (s) => {
        stderr += s;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(2);
    expect(stderr).toContain("HTTP 404");
  });

  test("upstream returns malformed JSON body (200) → exit 2, stderr labeled 'Parse failed', not 'Fetch failed'", async () => {
    let stderr = "";
    const code = await runCheckDrift({
      vendored: {},
      fetch: async () => new Response("not json {{{", { status: 200 }),
      print: () => {},
      printErr: (s) => {
        stderr += s;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(2);
    expect(stderr).toContain("Parse failed");
    expect(stderr).not.toContain("Fetch failed");
  });

  test("upstream returns JSON array → exit 2, stderr 'non-object JSON'", async () => {
    let stderr = "";
    const code = await runCheckDrift({
      vendored: {},
      fetch: async () => new Response("[1,2,3]", { status: 200 }),
      print: () => {},
      printErr: (s) => {
        stderr += s;
      },
      vendoredDate: "2026-05-01",
    });
    expect(code).toBe(2);
    expect(stderr).toContain("non-object JSON");
    expect(stderr).toContain("array");
  });
});

describe("runCheckKiroDrift", () => {
  const baseMeta = {
    sourceUrl: "https://example.test/kiro-schema.json",
    lastVerifiedDate: "2026-05-28",
    knownDivergences: [{ field: "resources" }],
  };

  test("no drift → exit 0, message confirms in-sync", async () => {
    const vendored = {
      properties: { name: {}, description: {}, prompt: {}, resources: {} },
    };
    let stdout = "";
    const code = await runCheckKiroDrift({
      vendored,
      meta: baseMeta,
      fetch: async () => new Response(JSON.stringify(vendored)),
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("in sync");
  });

  test("drift detected → exit 1, lists added/removed fields", async () => {
    const vendored = {
      properties: { name: {}, description: {}, prompt: {} },
    };
    const live = {
      properties: { name: {}, description: {}, prompt: {}, newField: {} },
    };
    let stdout = "";
    const code = await runCheckKiroDrift({
      vendored,
      meta: baseMeta,
      fetch: async () => new Response(JSON.stringify(live)),
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(1);
    expect(stdout).toContain("newField");
  });

  test("knownDivergences are filtered out (no false positives)", async () => {
    const vendored = {
      properties: { name: {}, prompt: {}, resources: { items: { pattern: "^(file://)" } } },
    };
    // Live schema mutates the resources field — tests that it's filtered
    // because 'resources' is in knownDivergences.
    const live = {
      properties: {
        name: {},
        prompt: {},
        resources: { items: { pattern: "^(file://|skill://)" } },
      },
    };
    let stdout = "";
    const code = await runCheckKiroDrift({
      vendored,
      meta: baseMeta,
      fetch: async () => new Response(JSON.stringify(live)),
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
  });

  test("network failure → exit 2", async () => {
    let stderr = "";
    const code = await runCheckKiroDrift({
      vendored: {},
      meta: baseMeta,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      print: () => {},
      printErr: (s) => {
        stderr += s;
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("ECONNREFUSED");
  });
});
