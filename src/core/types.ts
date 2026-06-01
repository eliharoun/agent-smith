/**
 * The three platforms agent-smith installs to.
 */
import type { KnowledgeBlock } from "./knowledge/types";

export type Target = "opencode" | "claude-code" | "codex" | "kiro" | "agents-md";

/**
 * Per-target install root paths. Shared by installer (writes there),
 * uninstaller (removes from there), and the CLI command layer (which
 * resolves them via `defaultInstallPaths` and threads them through).
 *
 * Keyed by Target so adding a new platform automatically requires every
 * consumer to provide its install root.
 */
export type InstallPaths = Record<Target, string>;

/**
 * Where an agent's source files live.
 *  - user-global: ~/.config/agent-smith/agents/<name>/
 *  - project:    <project>/.agent-smith/agents/<name>/
 *  - registered: <repo>/agents/<name>/  (external git repo)
 */
export type SourceKind = "user-global" | "project" | "registered";

/**
 * One entry in the AGENT registry. Represents a directory containing
 * one or more agent bundles (per-bundle subdir with `agent.config.json`).
 *
 * User-facing terminology: "agent catalog". The internal type name
 * `Source` is preserved for historical reasons; user-visible strings
 * (CLI help, status, error messages) consistently say "agent catalog".
 *
 * Parallel structure: `SkillCatalog` (in src/io/skill-registry.ts) is
 * the equivalent for the SKILL registry. The two registries are kept
 * separate because their content schemas differ (agent.config.json vs
 * SKILL.md), their consumers differ (smith agent install/daemon vs smith
 * skill install/list), and their lifecycles differ (agents are
 * rendered+installed; skills are referenced in place).
 */
/**
 * Provenance for a Source/SkillCatalog that was cloned from an external
 * git repository via `smith agent install --from <url>` or `smith skill
 * install --from <url>`. Added in C-series (v0.25.0); persisted as part
 * of registry.json schemaVersion: 2 and skill-catalogs.json schemaVersion: 2.
 *
 * Fields:
 *   - `url`: the canonical git URL the clone tracks.
 *   - `ref`: branch/tag/SHA the catalog is pinned to. Default `HEAD`.
 *   - `lastPulledSha`: 40-char SHA of the commit currently checked out.
 *   - `lastPulledAt`: ISO8601 timestamp of the last successful pull.
 *   - `lastRemoteSha`: 40-char SHA the daemon last observed at the remote
 *     via `git ls-remote`. May be ahead of `lastPulledSha` (drift signal).
 *   - `lastCheckedAt`: ISO8601 timestamp of the last `ls-remote` probe.
 */
export interface Remote {
  url: string;
  ref: string;
  lastPulledSha?: string;
  lastPulledAt?: string;
  lastRemoteSha?: string;
  lastCheckedAt?: string;
}

export interface Source {
  kind: SourceKind;
  /** Absolute path to the directory containing per-agent subdirectories. */
  rootPath: string;
  /** For SourceKind=registered, the git remote URL. Omitted otherwise. */
  gitRemote?: string;
  /** Human-readable label shown in `smith agent list`. */
  label: string;
  /**
   * Git provenance for catalogs cloned via `smith agent install --from
   * <url>` (C-series, v0.25.0). Undefined for local-only catalogs.
   */
  remote?: Remote;
}

/**
 * One of the three actions a permission group or pattern may evaluate to.
 * Mirrors OpenCode's published permission action enum.
 */
export const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Structured permission config. Top-level keys are permission groups (e.g.
 * `bash`, `edit`); values are either a bare action or a per-pattern record.
 */
export type PermissionConfig = Record<string, PermissionAction | Record<string, PermissionAction>>;

/**
 * All accepted modelTier values: canonical names + legacy aliases.
 * The Zod schema accepts any of these; aliases are normalized at parse time.
 */
export type ModelTierInput = "high" | "balanced" | "fast" | "opus" | "sonnet" | "haiku" | "inherit";

/**
 * Canonical modelTier values after normalization. Legacy aliases
 * (`opus`/`sonnet`/`haiku`) are mapped to these at parse time.
 */
export type CanonicalModelTier = "high" | "balanced" | "fast" | "inherit";

/** Maps legacy tier aliases to their canonical equivalents. */
const MODEL_TIER_ALIAS_MAP: Record<string, CanonicalModelTier> = {
  opus: "high",
  sonnet: "balanced",
  haiku: "fast",
};

/**
 * Normalize a modelTier input to its canonical form.
 * Aliases (`opus` → `high`, `sonnet` → `balanced`, `haiku` → `fast`)
 * are resolved; canonical values and `inherit` pass through unchanged.
 */
export function normalizeModelTier(input: ModelTierInput): CanonicalModelTier {
  return MODEL_TIER_ALIAS_MAP[input] ?? (input as CanonicalModelTier);
}

/**
 * Per-target rendering options for the `agents-md` target.
 */
export interface AgentsMdTargetOptions {
  /** Override the rendered file path (default: "AGENTS.md"). */
  path?: string;
}

/**
 * Per-target rendering options for the `claude-code` target.
 */
export interface ClaudeCodeTargetOptions {
  /**
   * When true and `agents-md` is also a target, the claude-code render
   * becomes a 1-line pointer ("See AGENTS.md.") instead of the full body.
   * Default: true when both targets are present in `targets`, undefined
   * otherwise. Set to `false` to opt out of the auto-defer.
   */
  deferToAgentsMd?: boolean;
}

/**
 * The canonical agent configuration. Lives in agent.config.json.
 * Translated per-target at install time.
 */
export interface CanonicalConfig {
  /**
   * Schema-format version. Currently `1`. Migration of legacy on-disk configs
   * missing this field is handled by `parseConfig()` (read-only, in-memory
   * injection). See B10 in `docs/2026-05-22-road-to-v1-checklist.md`.
   */
  schemaVersion: 1;
  /** Agent name. Must match directory name. kebab-case. */
  name: string;
  /** One-line description starting with an action phrase. Drives auto-delegation. */
  description: string;
  /** Targets to install to. */
  targets: Target[];
  /** Model tier hint. Each translator maps to its platform's model id. */
  modelTier: CanonicalModelTier;
  /**
   * Optional explicit OpenCode model id (e.g. "github-copilot/claude-opus-4.7").
   * OpenCode-only override; bypasses tier resolution for OpenCode.
   * Claude Code and Codex ignore this field.
   *
   * If both `model` and `modelTier` are set, validator emits info-note.
   * If `model` is set on a config without "opencode" in `targets`,
   * validator emits info-note (no effect on output).
   */
  model?: string;
  /** OpenCode-style mode. */
  mode?: "primary" | "subagent" | "all";
  /** 0.0 - 1.0. Optional. */
  temperature?: number;
  /** Display color. Optional, platform-dependent. */
  color?: string;
  /**
   * Granular permissions, structured per OpenCode's published schema.
   * Each top-level key is a permission group (e.g. `bash`, `edit`, `read`).
   * The value is either a bare action ("allow" | "ask" | "deny") that applies
   * to the whole group, or a record mapping patterns to actions for finer
   * control (e.g. `{ bash: { "git *": "allow", "*": "deny" } }`).
   *
   * See `permission-presets.ts` for ready-made presets (`read-only`,
   * `read-edit`, `full`) and the `expandPreset` helper.
   */
  permission?: PermissionConfig;
  /** Names of MCP servers this agent expects to be available. Documentation + validator hint only — not emitted to any platform's frontmatter. */
  mcpServers?: string[];
  /** Names of skills this agent should default to using. Surfaced via a `## Default Skills` section appended to the assembled body. */
  skills?: string[];
  /** Domain knowledge sources to attach to this agent. See `src/core/knowledge/`. */
  knowledge?: KnowledgeBlock;
  /**
   * Skills this agent requires to be installed in order to function.
   * `smith agent install <agent>` checks each entry against the user's
   * `installed-skills.json` and prompts to install any missing.
   *
   * Distinct from `permission.skill`:
   *   - `permission.skill` = runtime allow-list (which already-installed
   *     skills the agent's Skill tool may load).
   *   - `requires.skills` = delivery declaration (which skills must be
   *     installed for the agent to function).
   *
   * The two fields can coexist; the architect skill (Q7 mode b) writes both.
   */
  requires?: {
    skills?: Array<{
      /** Optional. If absent, resolves like `smith skill install <name>`
       *  (searches all catalogs; errors on ambiguity). */
      catalog?: string;
      /** Required. Kebab-case skill name, matching the dirname under the
       *  platform's skill dir. */
      name: string;
    }>;
  };
  /**
   * Per-bundle declaration of platform-native context-loading conventions
   * (steering files, AGENTS.md, etc.) that the bundle author wants
   * injected into the rendered agent file for each target. Optional; when
   * omitted, smith falls back to the user-global preference in
   * ~/.config/agent-smith/conventions.json (Task 3.2) and finally to a
   * CLI-flag/prompt-or-reject path (Task 3.3 resolveConventions).
   *
   * Bundle author's intent wins over user-global preferences — a bundle
   * that needs steering files to function declares them here so the
   * install isn't subject to the user's machine-wide opt-out.
   *
   * Each value is a list of convention IDs from the PLATFORM_CONVENTIONS
   * registry (src/core/platform-conventions.ts). Unknown IDs in saved
   * prefs are silently ignored at resolve time (forward-compat for
   * registry shrinkage).
   */
  platformConventions?: Partial<Record<Target, string[]>>;
  /**
   * Per-target rendering options that don't fit the canonical fields above.
   * Each sub-key is target-specific and additive — omitting the block
   * leaves all targets at their defaults.
   *
   * Currently used for:
   *   - agentsMd.path: override the rendered file path (default "AGENTS.md").
   *   - claudeCode.deferToAgentsMd: when true and `agents-md` is also a
   *     target, the claude-code render becomes a 1-line pointer
   *     ("See AGENTS.md.") instead of the full body. Default is true when
   *     both targets are present in `targets`, undefined otherwise.
   */
  targetOptions?: {
    agentsMd?: AgentsMdTargetOptions;
    claudeCode?: ClaudeCodeTargetOptions;
  };
  /**
   * Optional per-bundle override of validator thresholds. Replaces the
   * corresponding global default for any field that is set; omitted fields
   * fall back to global defaults. See `src/core/thresholds.ts` for the
   * default values and merge semantics. `failChars` is intentionally NOT
   * overridable — see the validator's design notes.
   */
  thresholds?: {
    /**
     * Each value is a length-2 tuple `[min, max]` of positive integers
     * (`min >= 1`, `max >= min`). Length-2 arity is enforced at runtime by
     * the zod schema (`z.tuple([...,...])`); zod 4's tuple inference
     * produces `[number, number]`, which satisfies the schema-vs-type
     * parity assertion (`_Check`) in `config-schema.ts`. Validator usage
     * destructures `[min, max] = range` after consulting the schema.
     */
    lineRanges?: {
      identity?: [number, number];
      expertise?: [number, number];
      soul?: [number, number];
      user?: [number, number];
    };
    warnChars?: number;
  };
}

/**
 * An agent on disk, post-discovery, pre-assembly.
 * Holds raw file contents but does not yet have an assembled body.
 */
export interface AgentBundle {
  config: CanonicalConfig;
  source: Source;
  /** Absolute path to the agent's directory. */
  bundlePath: string;
  files: {
    identity: string;
    expertise: string;
    soul: string;
    /** Resolved through symlink — actual content of USER.md. */
    user: string;
  };
}

/**
 * Common fields shared by every rendered agent regardless of output format.
 */
export interface RenderedAgentBase {
  target: Target;
  /**
   * Path of the on-disk file relative to the platform's install root. Each
   * translator decides its own filename convention. The installer joins this
   * with `paths[target]`. Subsumes the old `filename` field plus the codex
   * path special-case (which previously lived in installer.ts).
   *
   * Examples:
   *   opencode/claude-code: "<name>.md"
   *   codex:                "<name>/SKILL.md"  (AGENTS.md skill convention)
   *   kiro (Commit 2):      "<name>.json"
   */
  relativePath: string;
  /** Optional translator warnings (e.g. "ask action has no claude-code equivalent"). */
  warnings?: string[];
  /**
   * Absolute path of the source bundle this render came from. Set by the
   * orchestrator after translation; translators don't populate it. Used by
   * the installer's dedup warning so users can tell *which* bundle won when
   * the same (target, relativePath) appears in multiple sources.
   */
  bundlePath?: string;
}

/**
 * The output of a translator. Discriminated by `format`:
 *  - "markdown-frontmatter" — YAML frontmatter + markdown body (opencode,
 *    claude-code, codex). Installer serializes via js-yaml + body.
 *  - "json" — single JSON object (kiro, future platforms). Installer
 *    serializes via JSON.stringify with deep key sort for determinism.
 *
 * The installer dispatches serialization on `format`. Cross-cutting concerns
 * like knowledge-permission-grant (`injectKnowledgeIntoRender`) also dispatch
 * on `format` to mutate the appropriate field.
 */
export type RenderedAgent =
  | (RenderedAgentBase & {
      format: "markdown-frontmatter";
      /** Parsed frontmatter object (will be serialized by the installer). */
      frontmatter: Record<string, unknown>;
      /** Assembled markdown body (no frontmatter). */
      body: string;
    })
  | (RenderedAgentBase & {
      format: "json";
      /** The complete JSON document smith writes to disk. */
      data: Record<string, unknown>;
    });

/**
 * Resolved per-target model passed from orchestrator to translator.
 * `undefined` means "do not write a `model:` line in this target's frontmatter."
 * Resolution itself happens in `src/core/model-resolution/`.
 */
export interface ResolvedModelContext {
  resolvedModel: string | undefined;
  /**
   * Opt-in flag for emitting refresh hooks into target frontmatter.
   * Default (undefined/false): translators MUST NOT emit any refresh
   * hook block, even if the canonical config declares session/always
   * mode sources. Only the install CLI sets this to `true` for a bundle
   * after explicit user consent (interactive prompt or
   * `--refresh-consent yes`), and never when `--no-refresh-hooks` is
   * passed.
   *
   * This gate exists because consent is a CLI concern; the translator
   * is downstream of consent. Emitting hooks without consent leaks an
   * "orphan hook" — the `SessionStart` block in the agent file fires
   * `smith knowledge refresh-session` on every Claude session even
   * though no refresh manifest was written. See spec §5.2.
   */
  withRefreshHooks?: boolean;
}
