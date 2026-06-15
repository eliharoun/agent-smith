import { describe, expect, test } from "bun:test";
import {
  getConventionsForPlatform,
  PLATFORM_CONVENTIONS,
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

  test("registers claude-code conventions (CLAUDE.md workspace + global)", () => {
    const cc = PLATFORM_CONVENTIONS["claude-code"];
    expect(cc.length).toBeGreaterThan(0);
    const ws = cc.find((c) => c.scope === "workspace");
    expect(ws).toBeDefined();
    expect(ws?.promptDefault).toBe(true);
    expect(cc.some((c) => c.uris.some((u) => u.endsWith("CLAUDE.md")))).toBe(true);
    expect(
      cc.some((c) => c.scope === "user-global" && c.uris.includes("file://~/.claude/CLAUDE.md")),
    ).toBe(true);
  });

  test("registers opencode conventions (AGENTS.md workspace + global)", () => {
    const oc = PLATFORM_CONVENTIONS.opencode;
    expect(
      oc.some((c) => c.scope === "workspace" && c.uris.some((u) => u.endsWith("AGENTS.md"))),
    ).toBe(true);
    expect(
      oc.some(
        (c) => c.scope === "user-global" && c.uris.includes("file://~/.config/opencode/AGENTS.md"),
      ),
    ).toBe(true);
  });

  test("registers codex workspace AGENTS.md convention (global slot intentionally deferred)", () => {
    const cx = PLATFORM_CONVENTIONS.codex;
    expect(
      cx.some((c) => c.scope === "workspace" && c.uris.some((u) => u.endsWith("AGENTS.md"))),
    ).toBe(true);
    // Codex user-global path is ambiguous upstream (~/.codex/instructions.md vs
    // AGENTS.md, unstable support) — deliberately not registered.
    expect(cx.some((c) => c.scope === "user-global")).toBe(false);
  });

  test("agents-md target has no conventions (intentional — the target IS the file)", () => {
    expect(PLATFORM_CONVENTIONS["agents-md"]).toEqual([]);
  });

  test("every registered convention has a stable id, label, description, scope, and ≥1 URI", () => {
    for (const target of Object.keys(PLATFORM_CONVENTIONS) as Array<
      keyof typeof PLATFORM_CONVENTIONS
    >) {
      for (const c of PLATFORM_CONVENTIONS[target]) {
        expect(c.id).toMatch(/^[a-z][a-z0-9-]+$/);
        expect(c.label.length).toBeGreaterThan(0);
        expect(c.description.length).toBeGreaterThan(0);
        expect(c.uris.length).toBeGreaterThan(0);
        expect(["workspace", "user-global"]).toContain(c.scope);
      }
    }
  });

  test("workspace conventions use relative file:// URIs; user-global use ~-rooted", () => {
    for (const target of Object.keys(PLATFORM_CONVENTIONS) as Array<
      keyof typeof PLATFORM_CONVENTIONS
    >) {
      for (const c of PLATFORM_CONVENTIONS[target]) {
        for (const u of c.uris) {
          if (c.scope === "workspace") {
            expect(u.startsWith("file://~")).toBe(false);
            expect(u.startsWith("file://")).toBe(true);
          } else {
            expect(u.startsWith("file://~")).toBe(true);
          }
        }
      }
    }
  });

  test("getConventionsForPlatform returns the platform's list", () => {
    expect(getConventionsForPlatform("kiro").length).toBe(2);
    expect(getConventionsForPlatform("agents-md")).toEqual([]);
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
      target: "agents-md", // empty registry (intentional — target IS the file)
      bundleConfig: fakeBundleConfig({ targets: ["agents-md"] }),
      userPrefs: {
        schemaVersion: 1,
        platformConventions: { "agents-md": { default: "accept-all" } },
      },
      cliFlag: "accept-all",
      isTty: true,
    });
    expect(result.uris).toEqual([]);
  });
});
