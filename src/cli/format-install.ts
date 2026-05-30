/**
 * Pure-function formatter for the `smith agent install` output. Owned by
 * the CLI and consumed by both the install command and (via re-export) the
 * GUI install panel. Returns an array of strings the caller prints
 * line-by-line — keeps the formatter test-friendly without coupling to
 * stdout or pc colors.
 *
 * Sections, in order:
 *   1. Per-agent block. Header `[agent-name]` followed by per-target lines.
 *      Each line has a status glyph (✓ installed, · unchanged, ⚠ skipped).
 *   2. One-line summary. "N installed, M up to date" — or just "M up to
 *      date" when nothing was newly installed (the prior "0 installed" was
 *      misleading).
 *   3. Optional next-steps footer when warnings reference an actionable
 *      problem (e.g. "opencode auth login" suggested in a warning).
 *
 * Verbose mode (when `--verbose`) surfaces info-level translator warnings
 * (e.g. "Pattern-based permissions for group 'X' fall back to broadest").
 * These warnings are platform truisms or coarse-grained smith decisions
 * the user can't change without restructuring their bundle; hiding them
 * by default keeps install output focused.
 */

import type { InstallEntry } from "../io/installer";

export interface InstallSummaryInput {
  installed: InstallEntry[];
  skipped: InstallEntry[];
  warnings: string[];
}

export interface InstallSummaryOptions {
  /** Surface info-level translator warnings (default: false). */
  verbose?: boolean;
  /**
   * Optional ANSI styler. Tests pass nothing (returns plain text);
   * production passes through `picocolors` to color the glyphs and headers.
   */
  style?: InstallSummaryStyler;
}

/** Hooks for ANSI styling. Pass identity functions in tests. */
export interface InstallSummaryStyler {
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

const NO_STYLE: InstallSummaryStyler = {
  green: (s) => s,
  yellow: (s) => s,
  red: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
};

/**
 * Patterns whose match means "info-level: only print when --verbose".
 * Pattern-based permissions and the codex/claude-code permission truisms
 * fall in here. Action-needed warnings (model resolution failures, missing
 * platform CLIs the user might want) are NOT in this list and always print.
 */
const INFO_PATTERNS = [
  /Pattern-based permissions for group/i,
  /no deny semantic/i,
  /no native skill-tool runtime/i,
];

function isInfoWarning(w: string): boolean {
  return INFO_PATTERNS.some((p) => p.test(w));
}

/**
 * Parse warnings of the form `[agent/target] body` so we can group by
 * agent. Warnings without that prefix are returned with `null` agent.
 */
function parseWarning(w: string): { agent: string | null; target: string | null; body: string } {
  const m = w.match(/^\[([^/\]]+)(?:\/([^\]]+))?\]\s+(.*)$/);
  if (!m) return { agent: null, target: null, body: w };
  return { agent: m[1] ?? null, target: m[2] ?? null, body: m[3] ?? "" };
}

export function formatInstallSummary(
  input: InstallSummaryInput,
  options: InstallSummaryOptions = {},
): string[] {
  const style = options.style ?? NO_STYLE;
  const verbose = options.verbose === true;
  const out: string[] = [];

  if (input.installed.length === 0 && input.skipped.length === 0 && input.warnings.length === 0) {
    return out;
  }

  // Build a per-agent view that includes installed, unchanged, and skipped
  // (warning-driven) outcomes.
  type Outcome =
    | { kind: "installed"; target: string; path: string }
    | { kind: "unchanged"; target: string; path: string }
    | { kind: "skipped"; target: string; reason: string };

  const agentOutcomes = new Map<string, Outcome[]>();
  const ensureAgent = (name: string): Outcome[] => {
    const existing = agentOutcomes.get(name);
    if (existing) return existing;
    const fresh: Outcome[] = [];
    agentOutcomes.set(name, fresh);
    return fresh;
  };

  // When an entry has no `agent`, fall back to its filename stem so it
  // still appears in the grouped output. Matches the old test fixtures
  // and any callers that haven't been upgraded to fill in `agent`.
  const inferAgent = (path: string): string => {
    const parts = path.split("/");
    const last = parts[parts.length - 1] ?? path;
    if (last === "SKILL.md") return parts[parts.length - 2] ?? path;
    return last.replace(/\.(md|json)$/, "");
  };

  for (const e of input.installed) {
    const agent = e.agent ?? inferAgent(e.path);
    ensureAgent(agent).push({ kind: "installed", target: e.target, path: e.path });
  }
  for (const e of input.skipped) {
    const agent = e.agent ?? inferAgent(e.path);
    ensureAgent(agent).push({ kind: "unchanged", target: e.target, path: e.path });
  }
  // Skip-target warnings (e.g. unauthenticated opencode) become outcomes
  // tagged "skipped" so they appear in the per-agent block alongside
  // installs. Info-level warnings (truisms) don't get an outcome row.
  const passThroughWarnings: string[] = []; // warnings unattached to an agent
  for (const w of input.warnings) {
    const parsed = parseWarning(w);
    if (parsed.agent === null) {
      passThroughWarnings.push(w);
      continue;
    }
    if (parsed.target !== null && /target skipped/i.test(parsed.body)) {
      ensureAgent(parsed.agent).push({
        kind: "skipped",
        target: parsed.target,
        reason: parsed.body.replace(/^target skipped:\s*/i, ""),
      });
      continue;
    }
    // Other agent-prefixed warnings (translator info, etc.) attach as a
    // per-agent passthrough so they print at the agent's section unless
    // they're info-level and verbose is false.
    if (verbose || !isInfoWarning(w)) {
      passThroughWarnings.push(w);
    }
  }

  // Sort agents by name for stable output across runs.
  const agentNames = [...agentOutcomes.keys()].sort();
  for (const agent of agentNames) {
    const outcomes = agentOutcomes.get(agent) ?? [];
    out.push(style.bold(`[${agent}]`));
    for (const o of outcomes) {
      const targetLabel = o.target.padEnd(12);
      switch (o.kind) {
        case "installed":
          out.push(`  ${style.green("✓")} ${targetLabel}  ${o.path}`);
          break;
        case "unchanged":
          out.push(`  ${style.dim("·")} ${targetLabel}  ${o.path} ${style.dim("(unchanged)")}`);
          break;
        case "skipped":
          out.push(`  ${style.yellow("⚠")} ${targetLabel}  skipped: ${o.reason}`);
          break;
      }
    }
  }

  // One-line summary.
  const installedCount = input.installed.length;
  const skippedCount = input.skipped.length;
  let summary: string;
  if (installedCount > 0 && skippedCount > 0) {
    summary = `${installedCount} installed, ${skippedCount} up to date`;
  } else if (installedCount > 0) {
    summary = `${installedCount} installed`;
  } else if (skippedCount > 0) {
    summary = skippedCount === 1 ? "1 platform up to date" : `${skippedCount} up to date`;
  } else {
    summary = "";
  }
  if (summary !== "") {
    out.push(style.dim(summary));
  }

  // Pass-through warnings (non-skip, non-info, or verbose).
  for (const w of passThroughWarnings) {
    if (!verbose && isInfoWarning(w)) continue;
    out.push(`${style.yellow("warn")} ${w}`);
  }

  // Next-steps footer when at least one warning hints at an actionable
  // command. We surface the unique commands so the user has copy/paste-able
  // next steps.
  const actionPatterns = [
    { re: /(opencode auth login(?:\s+\S+)?)/i, label: "Authenticate OpenCode" },
    { re: /(claude auth login(?:\s+\S+)?)/i, label: "Authenticate Claude Code" },
    { re: /(codex login(?:\s+\S+)?)/i, label: "Authenticate Codex" },
    { re: /(kiro-cli login(?:\s+\S+)?)/i, label: "Authenticate Kiro" },
    { re: /(SMITH_TIER_(?:HIGH|BALANCED|FAST)=)/i, label: "Pin a model" },
  ];
  const nextSteps = new Map<string, string>(); // command → label
  for (const w of input.warnings) {
    for (const { re, label } of actionPatterns) {
      const m = w.match(re);
      if (m?.[1] && !nextSteps.has(m[1])) {
        nextSteps.set(m[1], label);
      }
    }
  }
  if (nextSteps.size > 0) {
    out.push("");
    out.push(style.bold("Next steps:"));
    for (const [cmd, label] of nextSteps) {
      out.push(`  ${label}: ${style.dim("`")}${cmd}${cmd.endsWith("=") ? "<value>" : ""}${style.dim("`")}`);
    }
  }

  return out;
}
