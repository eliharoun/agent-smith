import type { Target } from "../../core/types";

/**
 * Per-platform readiness for resolving and invoking models. Each install
 * target (`opencode`, `claude-code`, `codex`, `kiro`) gets its own report;
 * authenticated state of one platform never leaks into another's resolution.
 *
 * Status semantics:
 *   - `authenticated`     — CLI is on PATH AND credentials are present AND
 *                           we can name at least one model the platform will
 *                           accept at runtime (or the platform resolves tiers
 *                           natively and our auth signal is enough).
 *   - `unauthenticated`   — CLI is on PATH but no usable credentials. The
 *                           user has to run the platform's auth command.
 *   - `cli-not-installed` — Binary not on PATH. Not necessarily an error;
 *                           may simply mean the user doesn't use this
 *                           platform.
 *   - `unknown`           — We couldn't determine the state (e.g. permission
 *                           denied reading a config file). Treat as
 *                           informational; don't fail.
 */
export type AuthStatus = "authenticated" | "unauthenticated" | "cli-not-installed" | "unknown";

export interface PlatformAuth {
  /** Which install target this report describes. */
  platform: Target;
  /** Whether the platform's CLI binary is resolvable on $PATH. */
  cliInstalled: boolean;
  /** Authentication state — see {@link AuthStatus} for the precise semantics. */
  status: AuthStatus;
  /**
   * Platform-native model identifiers the user can invoke. Optional because
   * not every platform exposes a model list (Kiro is agent-based; Claude
   * Code may expose a list via settings.json availableModels but doesn't
   * always; Codex tier-maps to fixed literals).
   */
  availableModels?: string[];
  /**
   * Human-readable detail for the doctor display. Examples:
   *   - "logged in via Bedrock (opus, sonnet)"
   *   - "needs `claude auth login`"
   *   - "no providers configured (opencode auth login <provider>)"
   *   - "AWS SSO via amzn.awsapps.com"
   */
  detail?: string;
}

/**
 * Result of detecting auth across every supported platform. Caller can
 * dispatch one detector at a time or all at once via {@link detectAllPlatforms}.
 */
export type PlatformAuthMatrix = Record<Target, PlatformAuth>;
