import { describe, expect, test } from "bun:test";
import { NO_PLATFORM_REFUSAL_MESSAGE, runDoctorCli } from "../../src/cli/commands/doctor";
import type { PlatformId } from "../../src/io/platform-detect";

/**
 * Integration tests for the platform-detection behavior added to
 * runDoctorCli. The pre-existing tests/cli/doctor.test.ts covers the
 * already-installed happy paths (and now injects an all-three stub
 * detector to stay hermetic). This file isolates the new behavior:
 *
 *   1. The refusal path (zero platforms → exit 2 + install hint).
 *   2. Selective filtering (one platform detected → others omitted
 *      from report.platforms, listed in report.skippedPlatforms, and
 *      OpenCode-only sections like modelResolution are dropped).
 *
 * Tests use a /tmp cachePath that doesn't exist; the refusal path
 * short-circuits before the cache is touched, and the codex-only path
 * runs offline (noCache: true keeps it from writing).
 */

describe("runDoctorCli — refusal path", () => {
  test("zero platforms detected → prints refusal hint + exits 2 + does not fetch", async () => {
    const printed: string[] = [];
    let fetchCalled = false;
    const code = await runDoctorCli({
      offline: true,
      noCache: true,
      json: false,
      skipModelResolution: true,
      cachePath: "/tmp/agent-smith-doctor-refusal-test-no-cache.json",
      print: (line) => printed.push(line),
      fetch: async () => {
        fetchCalled = true;
        return new Response("", { status: 500 });
      },
      detectInstalledPlatforms: async () => new Set<PlatformId>(),
    });
    expect(code).toBe(2);
    expect(printed.join("\n")).toContain(NO_PLATFORM_REFUSAL_MESSAGE);
    // The refusal short-circuit must run before any I/O setup; the
    // injected fetch is a tripwire confirming runDoctor never executed.
    expect(fetchCalled).toBe(false);
  });

  test("zero platforms detected with --json → emits JSON envelope + exits 2", async () => {
    const printed: string[] = [];
    const code = await runDoctorCli({
      offline: true,
      noCache: true,
      json: true,
      skipModelResolution: true,
      cachePath: "/tmp/agent-smith-doctor-refusal-test-no-cache.json",
      print: (line) => printed.push(line),
      detectInstalledPlatforms: async () => new Set<PlatformId>(),
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(printed.join("\n")) as {
      error: string;
      exitCode: number;
      message: unknown;
    };
    expect(parsed.error).toBe("no-platform-detected");
    expect(parsed.exitCode).toBe(2);
    expect(typeof parsed.message).toBe("string");
  });
});

describe("runDoctorCli — happy path filtering", () => {
  test("only codex detected → report omits opencode/claude-code platforms; skippedPlatforms lists them", async () => {
    const printed: string[] = [];
    const code = await runDoctorCli({
      offline: true,
      noCache: true,
      json: true,
      skipModelResolution: true,
      cachePath: "/tmp/agent-smith-doctor-codex-only-test-no-cache.json",
      print: (line) => printed.push(line),
      detectInstalledPlatforms: async () => new Set<PlatformId>(["codex"]),
    });
    // Offline + only-codex → no drift, no network error → exit 0.
    expect(code).toBe(0);
    const parsed = JSON.parse(printed.join("\n")) as {
      platforms: { platform: string }[];
      skippedPlatforms: string[];
      modelResolution?: unknown;
    };
    expect(parsed.platforms.map((p) => p.platform)).toEqual(["codex"]);
    expect(parsed.skippedPlatforms.slice().sort()).toEqual(["claude-code", "kiro", "opencode"]);
    expect(parsed.modelResolution).toBeUndefined();
  });
});
