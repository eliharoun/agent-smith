// Cross-platform registry of platform-native context-loading conventions
// that built-in agents auto-load but custom (smith-rendered) agents must
// opt into.
//
// v1 registers kiro only:
//   - workspace-steering: file://.kiro/steering/**/*.md (promptDefault: true)
//   - global-steering:    file://~/.kiro/steering/**/*.md (promptDefault: false)
//
// Other platforms register conventions in follow-up data-only commits
// (CLAUDE.md, AGENTS.md, etc.) — design §12 future work.

import type { CanonicalConfig, Target } from "./types";
import type { ConventionsFile, DefaultStrategy } from "../io/conventions";

export interface PlatformConvention {
  /** Stable id used in agent.config.json and ~/.config/agent-smith/conventions.json. */
  id: string;
  /** Human-readable label for prompts and modal display. */
  label: string;
  /** Description for prompts and modal — tells the user what this convention does. */
  description: string;
  /** Workspace-scoped (relative URI) or user-global (home-relative URI). */
  scope: "workspace" | "user-global";
  /** file:// URI(s) emitted into the platform-native context-loading mechanism. */
  uris: readonly string[];
  /**
   * Pre-checked state in the prompt UI (and selected by the
   * `use-defaults` flag mode). Workspace-scoped conventions default to
   * checked because kiro's IDE built-in agents auto-load them; user-global
   * conventions default to unchecked to avoid surprising the user with
   * personal steering files in every smith agent.
   */
  promptDefault: boolean;
}

export const PLATFORM_CONVENTIONS: Record<Target, readonly PlatformConvention[]> = {
  kiro: [
    {
      id: "workspace-steering",
      label: "Workspace steering",
      description:
        "Auto-load .kiro/steering/**/*.md from the project root (the kiro IDE built-in agents do this by default).",
      scope: "workspace",
      uris: ["file://.kiro/steering/**/*.md"],
      promptDefault: true,
    },
    {
      id: "global-steering",
      label: "Global steering",
      description:
        "Auto-load ~/.kiro/steering/**/*.md (your personal steering files across all projects).",
      scope: "user-global",
      uris: ["file://~/.kiro/steering/**/*.md"],
      promptDefault: false,
    },
  ],
  opencode: [],
  "claude-code": [],
  codex: [],
  "agents-md": [],
};

export function getConventionsForPlatform(target: Target): readonly PlatformConvention[] {
  return PLATFORM_CONVENTIONS[target];
}

export interface ResolveConventionsInput {
  target: Target;
  bundleConfig: CanonicalConfig;
  userPrefs: ConventionsFile | null;
  cliFlag: DefaultStrategy | undefined;
  isTty: boolean;
  promptUser?: (
    target: Target,
    options: readonly PlatformConvention[],
  ) => Promise<string[]>;
}

export interface ResolveConventionsResult {
  uris: string[];
  source: "bundle" | "user-global" | "cli-flag" | "prompt" | "default-reject";
}

/**
 * Three-tier precedence resolution per design §6.2:
 *   1. Bundle declaration (agent.config.json platformConventions[target])
 *   2. User-global preference (~/.config/agent-smith/conventions.json)
 *   3. CLI flag → interactive prompt (TTY) → fail-safe-reject (non-TTY)
 *
 * Strategy values: accept-all | reject-all | use-defaults | prompt.
 * 'use-defaults' selects only conventions with promptDefault: true.
 * Unknown IDs in saved prefs are silently ignored (forward-compat for
 * registry shrinkage).
 */
export async function resolveConventions(
  input: ResolveConventionsInput,
): Promise<ResolveConventionsResult> {
  const conventions = getConventionsForPlatform(input.target);
  if (conventions.length === 0) {
    // No conventions registered for this target → no-op.
    return { uris: [], source: "default-reject" };
  }

  // Tier 1: bundle declaration
  const bundleDecl = input.bundleConfig.platformConventions?.[input.target];
  if (bundleDecl !== undefined) {
    const ids = new Set(bundleDecl);
    const uris = conventions.filter((c) => ids.has(c.id)).flatMap((c) => [...c.uris]);
    return { uris: uris.sort(), source: "bundle" };
  }

  // Tier 2: user-global preference
  const userPref = input.userPrefs?.platformConventions[input.target];
  if (userPref !== undefined) {
    if (userPref.explicit !== undefined) {
      const ids = new Set(userPref.explicit);
      const uris = conventions
        .filter((c) => ids.has(c.id))
        .flatMap((c) => [...c.uris]);
      return { uris: uris.sort(), source: "user-global" };
    }
    if (userPref.default !== undefined && userPref.default !== "prompt") {
      return resolveByStrategy(conventions, userPref.default, "user-global");
    }
  }

  // Tier 3: CLI flag
  if (input.cliFlag !== undefined && input.cliFlag !== "prompt") {
    return resolveByStrategy(conventions, input.cliFlag, "cli-flag");
  }

  // Tier 3 (TTY): interactive prompt
  if (input.isTty && input.promptUser) {
    const selectedIds = await input.promptUser(input.target, conventions);
    const ids = new Set(selectedIds);
    const uris = conventions.filter((c) => ids.has(c.id)).flatMap((c) => [...c.uris]);
    return { uris: uris.sort(), source: "prompt" };
  }

  // Non-TTY default: fail-safe-reject. Never inject convention URIs in
  // CI/automation without explicit consent.
  return { uris: [], source: "default-reject" };
}

function resolveByStrategy(
  conventions: readonly PlatformConvention[],
  strategy: DefaultStrategy,
  source: "user-global" | "cli-flag",
): ResolveConventionsResult {
  if (strategy === "accept-all") {
    return {
      uris: conventions.flatMap((c) => [...c.uris]).sort(),
      source,
    };
  }
  if (strategy === "reject-all") {
    return { uris: [], source };
  }
  if (strategy === "use-defaults") {
    return {
      uris: conventions
        .filter((c) => c.promptDefault)
        .flatMap((c) => [...c.uris])
        .sort(),
      source,
    };
  }
  // "prompt" — caller short-circuits before reaching here.
  return { uris: [], source };
}
