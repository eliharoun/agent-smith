import { detectClaudeCodeAuth } from "./claude-code";
import { detectCodexAuth } from "./codex";
import { detectKiroAuth } from "./kiro";
import { detectOpenCodeAuth } from "./opencode";
import type { PlatformAuth, PlatformAuthMatrix } from "./types";

export type {
  AuthStatus,
  PlatformAuth,
  PlatformAuthMatrix,
} from "./types";
export { detectOpenCodeAuth } from "./opencode";
export { detectClaudeCodeAuth } from "./claude-code";
export { detectCodexAuth } from "./codex";
export { detectKiroAuth } from "./kiro";

export interface DetectAllDeps {
  detectOpenCode?: () => Promise<PlatformAuth>;
  detectClaudeCode?: () => Promise<PlatformAuth>;
  detectCodex?: () => Promise<PlatformAuth>;
  detectKiro?: () => Promise<PlatformAuth>;
}

/**
 * Detect auth state for every supported platform in parallel.
 *
 * If any individual detector throws, the failure is converted to an
 * `unknown` PlatformAuth entry rather than propagating — the doctor
 * should never crash because one platform's auth check has a bug.
 */
export async function detectAllPlatforms(
  deps: DetectAllDeps = {},
): Promise<PlatformAuthMatrix> {
  const detectors: Array<{
    platform: PlatformAuth["platform"];
    fn: () => Promise<PlatformAuth>;
  }> = [
    { platform: "opencode", fn: deps.detectOpenCode ?? (() => detectOpenCodeAuth()) },
    {
      platform: "claude-code",
      fn: deps.detectClaudeCode ?? (() => detectClaudeCodeAuth()),
    },
    { platform: "codex", fn: deps.detectCodex ?? (() => detectCodexAuth()) },
    { platform: "kiro", fn: deps.detectKiro ?? (() => detectKiroAuth()) },
  ];

  const results = await Promise.all(
    detectors.map(async ({ platform, fn }) => {
      try {
        return await fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const fallback: PlatformAuth = {
          platform,
          cliInstalled: false,
          status: "unknown",
          detail: `auth detection failed: ${message}`,
        };
        return fallback;
      }
    }),
  );

  // Promise.all preserves order; map back into a record keyed by platform.
  const matrix: Partial<PlatformAuthMatrix> = {};
  for (const r of results) {
    matrix[r.platform] = r;
  }
  return matrix as PlatformAuthMatrix;
}
