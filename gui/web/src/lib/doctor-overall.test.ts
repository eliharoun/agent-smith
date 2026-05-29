import { describe, expect, it } from "vitest";
import { deriveOverallHealth, flattenChecks, isRefusal } from "./doctor-overall";

// NOTE: atlassianAuth=configured used as the "no-warning" baseline because
// flattenChecks intentionally marks `missing` as warn. The plan's original
// fixture used `missing`, but that produces a degraded baseline which
// contradicts the "no warnings" test name. Adjusted to keep helper logic
// intact (missing creds = warn is correct GUI behavior).
const baseReport = {
  generatedAt: "2026-05-20T10:00:00.000Z",
  platforms: [],
  skippedPlatforms: [],
  atlassianAuth: {
    status: "configured" as const,
    source: "env-smith" as const,
    baseUrl: "https://example.atlassian.net",
  },
  exitCode: 0 as 0 | 1 | 2,
};

describe("deriveOverallHealth", () => {
  it("returns 'healthy' for exitCode=0 with no warnings", () => {
    expect(deriveOverallHealth(baseReport)).toBe("healthy");
  });

  it("returns 'degraded' for exitCode=1", () => {
    expect(deriveOverallHealth({ ...baseReport, exitCode: 1 })).toBe("degraded");
  });

  it("returns 'unhealthy' for exitCode=2", () => {
    expect(deriveOverallHealth({ ...baseReport, exitCode: 2 })).toBe("unhealthy");
  });

  it("returns 'unhealthy' for refusal payload", () => {
    expect(
      deriveOverallHealth({
        error: "no-platform-detected",
        message: "x",
        exitCode: 2,
      }),
    ).toBe("unhealthy");
  });

  it("returns 'degraded' when atlassianAuth is missing (production-default warn path)", () => {
    const r = { ...baseReport, atlassianAuth: { status: "missing" as const } };
    expect(deriveOverallHealth(r)).toBe("degraded");
  });
});

describe("isRefusal", () => {
  it("detects the refusal shape", () => {
    expect(isRefusal({ error: "no-platform-detected", message: "x", exitCode: 2 })).toBe(true);
    expect(isRefusal(baseReport)).toBe(false);
  });
});

describe("flattenChecks", () => {
  it("emits one check per platform plus optional sections", () => {
    const r = {
      ...baseReport,
      platforms: [
        {
          platform: "opencode" as const,
          status: "fresh" as const,
          vendoredDate: "x",
          sourceUrl: "x",
          liveSchemaId: null,
          liveVersion: null,
        },
        {
          platform: "claude-code" as const,
          status: "manual" as const,
          lastVerifiedDate: "x",
          verifiedAgainstVersion: "x",
          sourceUrl: "x",
          notes: "n",
        },
      ],
      atlassianAuth: {
    status: "configured" as const,
    source: "env-smith" as const,
    baseUrl: "https://example.atlassian.net",
  },
    };
    const checks = flattenChecks(r);
    expect(checks.find((c) => c.id === "platform:opencode")?.status).toBe("ok");
    expect(checks.find((c) => c.id === "platform:claude-code")?.status).toBe("ok");
    expect(checks.find((c) => c.id === "atlassianAuth")?.status).toBe("ok");
  });

  it("maps drift to warn and network-error to error", () => {
    const r = {
      ...baseReport,
      platforms: [
        {
          platform: "opencode" as const,
          status: "drift" as const,
          vendoredDate: "x",
          sourceUrl: "x",
          liveSchemaId: null,
          liveVersion: null,
          drift: { added: ["a"], removed: [], changed: [], headline: "added a" },
        },
      ],
    };
    expect(flattenChecks(r).find((c) => c.id === "platform:opencode")?.status).toBe("warn");

    const r2 = {
      ...baseReport,
      platforms: [
        {
          platform: "opencode" as const,
          status: "network-error" as const,
          vendoredDate: "x",
          sourceUrl: "x",
          liveSchemaId: null,
          liveVersion: null,
          networkError: "ETIMEDOUT",
        },
      ],
    };
    expect(flattenChecks(r2).find((c) => c.id === "platform:opencode")?.status).toBe("error");
  });

  it("returns a single 'no platform' check for refusal payloads", () => {
    const checks = flattenChecks({
      error: "no-platform-detected",
      message: "Install one of...",
      exitCode: 2,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("error");
    expect(checks[0]?.id).toBe("refusal");
  });

  it("emits atlassianAuth as warn when status is missing", () => {
    const r = { ...baseReport, atlassianAuth: { status: "missing" as const } };
    expect(flattenChecks(r).find((c) => c.id === "atlassianAuth")?.status).toBe("warn");
  });
});
