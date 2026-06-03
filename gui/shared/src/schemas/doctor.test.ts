import { describe, expect, it } from "bun:test";
import { DoctorRefusal, DoctorReport, DoctorResponse } from "./doctor";

describe("DoctorReport (real CLI shape)", () => {
  it("parses a normal report with one fresh opencode platform and skipped others", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [
        {
          platform: "opencode",
          status: "fresh",
          vendoredDate: "2026-05-19",
          sourceUrl: "https://example",
          liveSchemaId: "x",
          liveVersion: "1.0",
        },
      ],
      skippedPlatforms: ["claude-code", "codex"],
      atlassianAuth: { status: "missing" },
      exitCode: 0,
    };
    const parsed = DoctorReport.safeParse(real);
    expect(parsed.success).toBe(true);
  });

  it("parses a drift report with exitCode=1", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [
        {
          platform: "opencode",
          status: "drift",
          vendoredDate: "2026-05-19",
          sourceUrl: "https://example",
          liveSchemaId: "x",
          liveVersion: "1.0",
          drift: { added: ["a"], removed: [], changed: [], headline: "added a" },
        },
      ],
      skippedPlatforms: [],
      atlassianAuth: {
        status: "configured",
        source: "env-smith",
        baseUrl: "https://acme.atlassian.net",
      },
      exitCode: 1,
    };
    const parsed = DoctorReport.safeParse(real);
    expect(parsed.success).toBe(true);
  });

  it("parses a network-error report with exitCode=2", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [
        {
          platform: "opencode",
          status: "network-error",
          vendoredDate: "2026-05-19",
          sourceUrl: "https://example",
          liveSchemaId: null,
          liveVersion: null,
          networkError: "ETIMEDOUT",
        },
      ],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      exitCode: 2,
    };
    const parsed = DoctorReport.safeParse(real);
    expect(parsed.success).toBe(true);
  });

  it("parses a manual claude-code platform entry", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [
        {
          platform: "claude-code",
          status: "manual",
          lastVerifiedDate: "2026-05-01",
          verifiedAgainstVersion: "1.2.3",
          sourceUrl: "https://example",
          notes: "manual review",
        },
      ],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      exitCode: 0,
    };
    expect(DoctorReport.safeParse(real).success).toBe(true);
  });

  it("rejects exitCode outside 0|1|2", () => {
    const bad = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      exitCode: 7,
    };
    expect(DoctorReport.safeParse(bad).success).toBe(false);
  });
});

describe("DoctorReport mcpDeps section", () => {
  it("parses a report with typed mcpDeps findings", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      mcpDeps: {
        findings: [
          { agent: "a", server: "s1", kind: "required", severity: "error" },
          { agent: "a", server: "s2", kind: "peer", severity: "warning" },
        ],
      },
      exitCode: 2,
    };
    expect(DoctorReport.safeParse(real).success).toBe(true);
  });

  it("rejects mcpDeps with an unknown kind", () => {
    const bad = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      mcpDeps: {
        findings: [{ agent: "a", server: "s", kind: "optional", severity: "warning" }],
      },
      exitCode: 0,
    };
    expect(DoctorReport.safeParse(bad).success).toBe(false);
  });
});

describe("DoctorReport urlRouting section", () => {
  it("parses a report with typed urlRouting entries and ambiguities", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      urlRouting: {
        entries: [
          { urlPattern: "https://example.com/*", source: "curated", server: "s1", tool: "fetch" },
          { urlPattern: "https://example.com/*", source: "_meta", server: "s2", tool: "fetch" },
        ],
        ambiguities: [
          {
            urlPattern: "https://example.com/*",
            claimants: [
              { server: "s1", tool: "fetch", source: "curated" },
              { server: "s2", tool: "fetch", source: "_meta" },
            ],
          },
        ],
      },
      exitCode: 0,
    };
    expect(DoctorReport.safeParse(real).success).toBe(true);
  });

  it("rejects urlRouting with an unknown source value", () => {
    const bad = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      urlRouting: {
        entries: [
          { urlPattern: "x", source: "bogus", server: "s", tool: "t" },
        ],
        ambiguities: [],
      },
      exitCode: 0,
    };
    expect(DoctorReport.safeParse(bad).success).toBe(false);
  });

  it("accepts a report with urlRouting absent", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      exitCode: 0,
    };
    expect(DoctorReport.safeParse(real).success).toBe(true);
  });
});

describe("DoctorRefusal", () => {
  it("parses the no-platform-detected short-circuit", () => {
    const refusal = {
      error: "no-platform-detected",
      message: "No supported AI coding platform detected on PATH.",
      exitCode: 2,
    };
    expect(DoctorRefusal.safeParse(refusal).success).toBe(true);
  });

  it("rejects refusal with wrong error literal", () => {
    expect(DoctorRefusal.safeParse({ error: "other", message: "x", exitCode: 2 }).success).toBe(
      false,
    );
  });
});

describe("DoctorResponse (discriminated union)", () => {
  it("accepts a normal report", () => {
    const real = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [],
      skippedPlatforms: [],
      atlassianAuth: { status: "missing" },
      exitCode: 0,
    };
    expect(DoctorResponse.safeParse(real).success).toBe(true);
  });

  it("accepts a refusal", () => {
    const refusal = { error: "no-platform-detected", message: "x", exitCode: 2 };
    expect(DoctorResponse.safeParse(refusal).success).toBe(true);
  });
});
