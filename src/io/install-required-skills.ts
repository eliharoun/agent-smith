/**
 * Resolve the `requires.skills` block of an agent's config: detect missing
 * skills, then prompt-or-auto-install via the skill installer. NEVER aborts
 * the agent install — install failures degrade to warnings so the user sees
 * the agent install attempt complete and can address skill issues separately.
 *
 * Pure function with all I/O parameterized.
 */
import { toMessage } from "../core/to-message";
import {
  diffRequiredSkills,
  formatSkillRef,
  type RequiredSkillEntry,
} from "./required-skills";

export type InstallRequiredSkillsMode = "prompt" | "with-skills" | "no-skills";

export interface InstallRequiredSkillsOpts {
  /** Agent name, used in user-facing prompt + warning messages. */
  agentName: string;
  /** From the agent's `requires.skills` field. */
  required: readonly RequiredSkillEntry[];
  /**
   *  - "prompt" (default): ask the user [Y/n] for each missing skill.
   *  - "with-skills": auto-install missing skills, no prompt (--yes / --with-skills).
   *  - "no-skills": skip all, warn at the end (--no-skills).
   */
  mode: InstallRequiredSkillsMode;

  /** Returns names of skills currently installed. */
  loadInstalledSkillNames: () => Promise<string[]>;
  /** Installs `<catalog>/<name>` or `<name>`; throws on failure. */
  installSkillByRef: (ref: string) => Promise<void>;
  /** One-line prompt (returns trimmed answer). Test injects a stub. */
  prompt: (msg: string) => Promise<string>;
  /**
   * Returns true if stdin is a TTY (i.e. interactive prompts are safe).
   * Defaults to `process.stdin.isTTY ?? false`. Injected for tests.
   *
   * In "prompt" mode on a non-TTY stream (CI, piped stdin), the prompt loop
   * would block forever waiting on input. We treat that case as "skip + warn"
   * rather than "auto-install" so we never install without consent.
   */
  isTTY?: () => boolean;
}

export interface InstallRequiredSkillsResult {
  /** Skill refs that were successfully installed by this run. */
  installed: string[];
  /** Skill refs that were intentionally skipped (user said no, --no-skills, or install failed). */
  skipped: string[];
  /** Human-readable warnings to surface to the user. */
  warnings: string[];
}

export async function installRequiredSkills(
  opts: InstallRequiredSkillsOpts,
): Promise<InstallRequiredSkillsResult> {
  const result: InstallRequiredSkillsResult = {
    installed: [],
    skipped: [],
    warnings: [],
  };

  if (opts.required.length === 0) return result;

  const installedNames = await opts.loadInstalledSkillNames();
  const missing = diffRequiredSkills(opts.required, installedNames);
  if (missing.length === 0) return result;

  // Non-TTY guard: in "prompt" mode on a non-interactive stream we cannot
  // ask the user, and silently auto-installing without consent is wrong.
  // Degrade to "skip + warn" with a single, actionable warning naming every
  // missing skill and the flags to override.
  const isTTY = opts.isTTY ?? (() => process.stdin.isTTY ?? false);
  const effectiveMode: InstallRequiredSkillsMode =
    opts.mode === "prompt" && !isTTY() ? "no-skills" : opts.mode;
  if (opts.mode === "prompt" && effectiveMode === "no-skills") {
    const refs = missing.map(formatSkillRef);
    for (const ref of refs) {
      result.skipped.push(ref);
    }
    result.warnings.push(
      `Agent '${opts.agentName}' requires skill(s) ${refs
        .map((r) => `'${r}'`)
        .join(", ")} but stdin is non-interactive (non-TTY); skipping. ` +
        `Re-run with --yes or --with-skills to auto-install, or --no-skills to silence this warning.`,
    );
    return result;
  }

  for (const entry of missing) {
    const ref = formatSkillRef(entry);

    let shouldInstall: boolean;
    switch (opts.mode) {
      case "with-skills":
        shouldInstall = true;
        break;
      case "no-skills":
        shouldInstall = false;
        break;
      case "prompt": {
        const catalogClause = entry.catalog ? ` from catalog '${entry.catalog}'` : "";
        // Up to 3 attempts on ambiguous input. Treating "maybe" / "sure" /
        // typos as silent-no would surprise the user; re-prompting once or
        // twice is the cheap remedy. After 3 unclear answers we give up
        // with an explanatory warning rather than looping forever.
        const MAX_ATTEMPTS = 3;
        let parsed: "yes" | "no" | "unknown" = "unknown";
        let attempts = 0;
        while (attempts < MAX_ATTEMPTS && parsed === "unknown") {
          const answer = await opts.prompt(
            `Agent '${opts.agentName}' requires skill '${entry.name}'${catalogClause}. Install? [Y/n] `,
          );
          parsed = parseYesNo(answer);
          attempts += 1;
        }
        if (parsed === "unknown") {
          // Treat as skip but with a warning that explains it was an
          // unclear-input giveup, not a "may not function" reminder.
          result.skipped.push(ref);
          result.warnings.push(
            `Skipped required skill '${ref}' for agent '${opts.agentName}': prompt answers were unclear after ${MAX_ATTEMPTS} attempts. Run \`smith skill install ${ref}\` to install it manually.`,
          );
          continue;
        }
        shouldInstall = parsed === "yes";
        break;
      }
    }

    if (!shouldInstall) {
      result.skipped.push(ref);
      result.warnings.push(
        `Required skill '${ref}' was not installed. Agent '${opts.agentName}' may not function until you run \`smith skill install ${ref}\`.`,
      );
      continue;
    }

    try {
      await opts.installSkillByRef(ref);
      result.installed.push(ref);
    } catch (err) {
      result.skipped.push(ref);
      result.warnings.push(
        `Failed to install required skill '${ref}': ${toMessage(err)}. Run \`smith skill install ${ref}\` manually.`,
      );
    }
  }

  return result;
}

/**
 * Classify a [Y/n] prompt answer.
 * - Empty string → yes (default).
 * - y / yes (case-insensitive) → yes.
 * - n / no (case-insensitive) → no.
 * - Anything else → unknown (caller decides whether to re-prompt).
 *
 * Whitespace is trimmed. Internal whitespace (e.g. " y ") is tolerated.
 */
function parseYesNo(answer: string): "yes" | "no" | "unknown" {
  const trimmed = answer.trim();
  if (trimmed === "") return "yes";
  if (/^y(es)?$/i.test(trimmed)) return "yes";
  if (/^no?$/i.test(trimmed)) return "no";
  return "unknown";
}
