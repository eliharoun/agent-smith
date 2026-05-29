import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { bootstrap } from "../../../../scripts/bootstrap";
import { SmithError } from "../../../core/smith-error";

/**
 * Resolve the agent-smith repo root from the location of this command file.
 * The CLI lives at <repo>/src/cli/commands/skill/bootstrap.ts; the repo
 * root is four directories up.
 */
function findRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "../../../..");
}

export interface SkillBootstrapCliOpts {
  dryRun?: boolean;
  targets?: string;
}

/**
 * Implements `smith skill bootstrap`. Installs the bundled skills
 * (`the-architect`, `the-keymaker`) into the requested platform skill
 * directories. Replaces the pre-Batch-20 top-level `smith bootstrap`,
 * which also installed the agent-smith persona — persona install moved
 * to bin/install Step 9 + smith update Step 4 + `smith agent install
 * agent-smith`.
 */
export async function runSkillBootstrapCli(
  opts: SkillBootstrapCliOpts,
): Promise<number> {
  const repoRoot = findRepoRoot();

  const allPlatforms = {
    opencode: join(homedir(), ".config/opencode/skills"),
    "claude-code": join(homedir(), ".claude/skills"),
    // Codex skills and agents share `~/.agents/skills/` per Codex spec
    // (https://developers.openai.com/codex/skills). Both are
    // directory-with-SKILL.md shaped; collisions only occur if a skill
    // and agent share a name.
    codex: join(homedir(), ".agents/skills"),
  } as const;

  const wanted = opts.targets
    ? new Set(opts.targets.split(",").map((t) => t.trim()))
    : new Set(Object.keys(allPlatforms));

  // CLI-28: reject unknown target keys upfront. Pre-this guard, a typo
  // like `--targets opnecode,claude-code` silently ran ONLY claude-code
  // because the bogus key was filtered out of `Object.entries(...).filter`.
  // Users believed both ran. Mirrors the parseTargets pattern in
  // src/cli/commands/skill/install-cmd.ts.
  const validTargets = Object.keys(allPlatforms);
  if (opts.targets) {
    for (const k of wanted) {
      if (!validTargets.includes(k)) {
        throw new SmithError({
          code: "usage-error",
          message: `unknown target '${k}'; expected one of: ${validTargets.join(", ")}`,
          suggestedCommand: `smith skill bootstrap --targets ${validTargets.join(",")}`,
        });
      }
    }
  }

  const platforms = Object.fromEntries(
    Object.entries(allPlatforms).filter(([k]) => wanted.has(k)),
  ) as typeof allPlatforms;

  const result = await bootstrap({
    repoRoot,
    platforms,
    mode: "cli",
    ...(opts.dryRun ? { dryRun: true } : {}),
  });

  console.log(
    `${opts.dryRun ? pc.yellow("[dry-run] ") : ""}Skill bootstrap: ${result.skillsLinked} skills linked, ${result.skillsSkipped} skipped.`,
  );
  for (const w of result.warnings) console.warn(pc.yellow(`warning: ${w}`));

  if (result.errors.length > 0) {
    throw new SmithError({
      code: "partial-failure",
      operation: "skill bootstrap",
      succeeded: result.skillsLinked,
      failed: result.errors.length,
      skipped: result.skillsSkipped,
      details: result.errors,
    });
  }
  return 0;
}
