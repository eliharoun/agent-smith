import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import { buildAndInstall } from "../../src/io/orchestrator";
import { fakeBundle } from "../_helpers/fakeBundle";

/**
 * When a bundle declares multiple targets and ONE platform's resolver
 * fails (unauthenticated), the installer should:
 *   - Skip that target
 *   - Emit a warning naming the affected target and reason
 *   - Install successfully into the other targets
 *   - NOT add an `errors[]` entry (the install isn't broken — one
 *     target is just unavailable, mirroring 'this target is missing
 *     from the system' semantics)
 */
describe("orchestrator: partial-target failure", () => {
  test("installs to claude-code when opencode resolution fails (unauth)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smith-partial-"));
    try {
      const paths = {
        opencode: join(root, "opencode/agents"),
        "claude-code": join(root, "claude/agents"),
        codex: join(root, "agents/skills"),
        kiro: join(root, "kiro/agents"),
        "agents-md": join(root, "agents-md/agents"),
      };

      // Inject a model env where:
      //   - opencode resolver throws (mimicking model-resolution-failed)
      //   - claude-code returns a valid literal
      //   - codex/kiro authentic
      const env: ModelResolutionEnv = {
        getOpenCodeModels: async () => undefined,
        warnings: { push() {} },
        detectAuthenticatedProviders: async () => [], // → opencode resolver will throw
        detectClaudeCodeAuth: async () => ({
          platform: "claude-code",
          cliInstalled: true,
          status: "authenticated",
          availableModels: ["opus", "sonnet", "haiku"],
        }),
      };

      const bundle = fakeBundle("multi-target-agent", { kind: "user-global" });
      // Force both opencode AND claude-code as targets.
      bundle.config.targets = ["opencode", "claude-code"];

      const result = await buildAndInstall([bundle], paths, {
        modelResolutionEnv: env,
        homeDir: root,
      });

      // Claude Code install path should exist. OpenCode shouldn't.
      const claudeInstalls = result.installed.filter((r) => r.target === "claude-code");
      const opencodeInstalls = result.installed.filter((r) => r.target === "opencode");
      expect(claudeInstalls.length).toBeGreaterThan(0);
      expect(opencodeInstalls.length).toBe(0);

      // A warning should have been emitted naming the skipped target.
      const w = result.warnings.find(
        (s) => s.includes("opencode") && /skipped|unauth|model resolution/i.test(s),
      );
      expect(w).toBeDefined();

      // The warning should NOT contain the redundant "model resolution failed"
      // string twice (it appeared in both the outer label and the inner
      // SmithError message before this fix).
      const occurrences = (w ?? "").match(/model resolution failed/g) ?? [];
      expect(occurrences.length).toBeLessThanOrEqual(1);

      // The warning should reference an actionable hint so the user knows
      // what to do (set env var or run `opencode auth login`).
      expect(w).toMatch(/opencode auth login|SMITH_TIER_HIGH/);

      // No errors[] entry — the bundle was successfully installed
      // (just to fewer targets than declared).
      expect(result.errors).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
