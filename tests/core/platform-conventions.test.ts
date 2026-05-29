import { describe, expect, test } from "bun:test";
import {
  PLATFORM_CONVENTIONS,
  getConventionsForPlatform,
  resolveConventions,
} from "../../src/core/platform-conventions";
import type { CanonicalConfig } from "../../src/core/types";

const fakeBundleConfig = (overrides: Partial<CanonicalConfig> = {}): CanonicalConfig => ({
  schemaVersion: 1,
  name: "x",
  description: "x",
  targets: ["kiro"],
  modelTier: "balanced",
  ...overrides,
});

describe("PLATFORM_CONVENTIONS registry", () => {
  test("registers kiro conventions", () => {
    const kiro = PLATFORM_CONVENTIONS.kiro;
    expect(kiro.length).toBeGreaterThan(0);
    expect(kiro.find((c) => c.id === "workspace-steering")).toBeDefined();
    expect(kiro.find((c) => c.id === "global-steering")).toBeDefined();
  });

  test("kiro workspace-steering is workspace-scoped, promptDefault: true", () => {
    const c = PLATFORM_CONVENTIONS.kiro.find((c) => c.id === "workspace-steering");
    expect(c?.scope).toBe("workspace");
    expect(c?.promptDefault).toBe(true);
    expect(c?.uris).toContain("file://.kiro/steering/**/*.md");
  });

  test("kiro global-steering is user-global, promptDefault: false", () => {
    const c = PLATFORM_CONVENTIONS.kiro.find((c) => c.id === "global-steering");
    expect(c?.scope).toBe("user-global");
    expect(c?.promptDefault).toBe(false);
    expect(c?.uris).toContain("file://~/.kiro/steering/**/*.md");
  });

  test("opencode/claude-code/codex have no conventions in v1", () => {
    expect(PLATFORM_CONVENTIONS.opencode).toEqual([]);
    expect(PLATFORM_CONVENTIONS["claude-code"]).toEqual([]);
    expect(PLATFORM_CONVENTIONS.codex).toEqual([]);
  });

  test("getConventionsForPlatform returns the platform's list", () => {
    expect(getConventionsForPlatform("kiro").length).toBe(2);
    expect(getConventionsForPlatform("opencode")).toEqual([]);
  });
});

describe("resolveConventions precedence", () => {
  test("Tier 1: bundle declaration wins over user-global, CLI, prompt", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig({
        platformConventions: { kiro: ["workspace-steering"] },
      }),
      userPrefs: { schemaVersion: 1, platformConventions: { kiro: { default: "reject-all" } } },
      cliFlag: "accept-all",
      isTty: true,
      promptUser: async () => ["global-steering"], // Should NOT be called
    });
    expect(result.source).toBe("bundle");
    expect(result.uris).toEqual(["file://.kiro/steering/**/*.md"]);
  });

  test("Tier 2: user-global default 'accept-all' selects all conventions", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: { schemaVersion: 1, platformConventions: { kiro: { default: "accept-all" } } },
      cliFlag: undefined,
      isTty: true,
    });
    expect(result.source).toBe("user-global");
    expect(result.uris).toContain("file://.kiro/steering/**/*.md");
    expect(result.uris).toContain("file://~/.kiro/steering/**/*.md");
  });

  test("Tier 2: user-global 'reject-all' returns empty", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: { schemaVersion: 1, platformConventions: { kiro: { default: "reject-all" } } },
      cliFlag: undefined,
      isTty: true,
    });
    expect(result.uris).toEqual([]);
  });

  test("Tier 2: user-global 'use-defaults' selects only promptDefault: true conventions", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: { schemaVersion: 1, platformConventions: { kiro: { default: "use-defaults" } } },
      cliFlag: undefined,
      isTty: true,
    });
    // workspace-steering has promptDefault: true; global-steering doesn't.
    expect(result.uris).toEqual(["file://.kiro/steering/**/*.md"]);
  });

  test("Tier 2: user-global 'explicit' overrides 'default'", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: {
        schemaVersion: 1,
        platformConventions: {
          kiro: { default: "accept-all", explicit: ["global-steering"] },
        },
      },
      cliFlag: undefined,
      isTty: true,
    });
    expect(result.uris).toEqual(["file://~/.kiro/steering/**/*.md"]);
  });

  test("Tier 3: CLI flag 'accept-all' bypasses prompt", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: null,
      cliFlag: "accept-all",
      isTty: true,
      promptUser: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.source).toBe("cli-flag");
    expect(result.uris.length).toBe(2);
  });

  test("Tier 3: prompt called when TTY and no other answer", async () => {
    let promptCalled = false;
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: null,
      cliFlag: undefined,
      isTty: true,
      promptUser: async () => {
        promptCalled = true;
        return ["workspace-steering"];
      },
    });
    expect(promptCalled).toBe(true);
    expect(result.source).toBe("prompt");
    expect(result.uris).toEqual(["file://.kiro/steering/**/*.md"]);
  });

  test("Tier 3: non-TTY default is fail-safe-reject", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: null,
      cliFlag: undefined,
      isTty: false,
    });
    expect(result.source).toBe("default-reject");
    expect(result.uris).toEqual([]);
  });

  test("unknown convention IDs in saved prefs are silently ignored", async () => {
    const result = await resolveConventions({
      target: "kiro",
      bundleConfig: fakeBundleConfig(),
      userPrefs: {
        schemaVersion: 1,
        platformConventions: {
          kiro: { explicit: ["workspace-steering", "removed-convention-id"] },
        },
      },
      cliFlag: undefined,
      isTty: false,
    });
    expect(result.uris).toEqual(["file://.kiro/steering/**/*.md"]);
  });

  test("empty registry for target → empty result regardless of inputs", async () => {
    const result = await resolveConventions({
      target: "opencode", // empty registry in v1
      bundleConfig: fakeBundleConfig({ targets: ["opencode"] }),
      userPrefs: { schemaVersion: 1, platformConventions: { opencode: { default: "accept-all" } } },
      cliFlag: "accept-all",
      isTty: true,
    });
    expect(result.uris).toEqual([]);
  });
});
