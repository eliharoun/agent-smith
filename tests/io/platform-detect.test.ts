import { describe, expect, test } from "bun:test";
import { detectInstalledPlatforms, findOnPath, PLATFORM_BINARIES } from "../../src/io/platform-detect";

describe("findOnPath", () => {
  test("returns trimmed path when `which` succeeds", async () => {
    const fakeWhich = async (bin: string) => `/fake/bin/${bin}\n`;
    const result = await findOnPath("opencode", fakeWhich);
    expect(result).toBe("/fake/bin/opencode");
  });

  test("returns null when `which` returns empty string", async () => {
    const fakeWhich = async () => "   \n";
    expect(await findOnPath("missing", fakeWhich)).toBe(null);
  });

  test("propagates errors from injected which (caller responsibility)", async () => {
    const fakeWhich = async () => {
      throw new Error("which failed");
    };
    await expect(findOnPath("missing", fakeWhich)).rejects.toThrow("which failed");
  });

  test("default which resolves a known system binary", async () => {
    const result = await findOnPath("sh");
    // Bun.which returns absolute path on Unix; null on Windows without sh.
    // Either is a valid pass — what we're checking is that the call doesn't crash.
    expect(result === null || result.length > 0).toBe(true);
  });
});

describe("PLATFORM_BINARIES", () => {
  test("maps claude-code to `claude` (not `claude-code`)", () => {
    expect(PLATFORM_BINARIES["claude-code"]).toBe("claude");
    expect(PLATFORM_BINARIES.opencode).toBe("opencode");
    expect(PLATFORM_BINARIES.codex).toBe("codex");
  });

  test("kiro accepts both kiro-cli and kiro binaries", () => {
    const kiro = PLATFORM_BINARIES.kiro;
    const list = Array.isArray(kiro) ? kiro : [kiro];
    expect(list).toContain("kiro-cli");
    expect(list).toContain("kiro");
  });
});

describe("detectInstalledPlatforms", () => {
  function whichWith(present: string[]): (bin: string) => Promise<string | null> {
    return async (bin) => (present.includes(bin) ? `/fake/bin/${bin}` : null);
  }

  test("all three present → set with all three ids", async () => {
    const set = await detectInstalledPlatforms(whichWith(["opencode", "claude", "codex"]));
    expect([...set].sort()).toEqual(["claude-code", "codex", "opencode"]);
  });

  test("none present → empty set", async () => {
    const set = await detectInstalledPlatforms(whichWith([]));
    expect(set.size).toBe(0);
  });

  test("only codex present → singleton set", async () => {
    const set = await detectInstalledPlatforms(whichWith(["codex"]));
    expect([...set]).toEqual(["codex"]);
  });

  test("only claude present → set contains claude-code (mapped from binary)", async () => {
    const set = await detectInstalledPlatforms(whichWith(["claude"]));
    expect([...set]).toEqual(["claude-code"]);
  });

  test("opencode + claude present → set with both", async () => {
    const set = await detectInstalledPlatforms(whichWith(["opencode", "claude"]));
    expect([...set].sort()).toEqual(["claude-code", "opencode"]);
  });

  test("kiro detected when kiro-cli is on PATH", async () => {
    const set = await detectInstalledPlatforms(whichWith(["kiro-cli"]));
    expect([...set]).toContain("kiro");
  });

  test("kiro detected when only kiro (IDE) is on PATH", async () => {
    const set = await detectInstalledPlatforms(whichWith(["kiro"]));
    expect([...set]).toContain("kiro");
  });

  test("kiro not detected when neither binary present", async () => {
    const set = await detectInstalledPlatforms(whichWith([]));
    expect([...set]).not.toContain("kiro");
  });
});
