import { resolve } from "node:path";
import pc from "picocolors";
import { SmithError } from "../../../core/smith-error";
import {
  addCatalog,
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  type SkillCatalogKind,
  saveSkillRegistry,
} from "../../../io/skill-registry";
import {
  defaultRunGit,
  type GitRunner,
  sniffPath,
  verifyGitRemote,
} from "../../registry-validation";
import { warnIfDuplicateGitRemote } from "../dup-remote-warn";

export interface SkillRegisterOptions {
  kind: SkillCatalogKind;
  label?: string;
  gitRemote?: string;
  /** Bypass the "no skills" error. Default: false. */
  allowEmpty?: boolean;
  /** Bypass the git-repo / remote-URL check. Default: false. */
  skipGitCheck?: boolean;
  /** Test seam. Defaults to canonicalSkillRegistryPath(). */
  registryPath?: string;
  /** Test seam. Defaults to defaultRunGit. */
  runGit?: GitRunner;
}

export async function skillRegister(rootPath: string, opts: SkillRegisterOptions): Promise<void> {
  const abs = resolve(rootPath);
  const registryPath = opts.registryPath ?? canonicalSkillRegistryPath();
  const runGit = opts.runGit ?? defaultRunGit;

  const sniff = await sniffPath(abs);
  if (!sniff.exists) {
    throw new SmithError({
      code: "validation-failed",
      what: "skill catalog",
      reasons: [`path ${abs} does not exist`],
    });
  }
  if (sniff.skillBundles === 0 && sniff.agentBundles > 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "skill catalog",
      reasons: [
        `path ${abs} looks like an agent catalog (found ${sniff.agentBundles} agent.config.json ${sniff.agentBundles === 1 ? "file" : "files"}, 0 SKILL.md)`,
        "Did you mean `smith agent register`?",
      ],
      suggestedCommand: `smith agent register ${abs} --kind registered --label <label>`,
    });
  }
  if (sniff.skillBundles === 0 && !opts.allowEmpty) {
    throw new SmithError({
      code: "validation-failed",
      what: "skill catalog",
      reasons: [
        `path ${abs} contains no skills (no subdirectories with SKILL.md)`,
        "Use --allow-empty to register anyway.",
      ],
      suggestedCommand: `smith skill register ${abs} --kind ${opts.kind}${opts.label ? ` --label ${opts.label}` : ""} --allow-empty`,
    });
  }

  if (opts.gitRemote && !opts.skipGitCheck) {
    const verify = await verifyGitRemote(abs, opts.gitRemote, runGit);
    if (!verify.ok) {
      if (verify.reason === "not-a-git-repo") {
        throw new SmithError({
          code: "validation-failed",
          what: "skill catalog",
          reasons: [`path ${abs} is not a git repository`],
          suggestedCommand: `smith skill register ${abs} --kind ${opts.kind} --git-remote ${opts.gitRemote} --skip-git-check`,
        });
      }
      const found = verify.found.map((r) => `${r.name} -> ${r.url}`).join(", ") || "(no remotes)";
      throw new SmithError({
        code: "validation-failed",
        what: "skill catalog",
        reasons: [
          `--git-remote ${opts.gitRemote} does not match any remote of ${abs}`,
          `found: ${found}`,
        ],
      });
    }
  }

  // RC2-5: warn on duplicate URL (cross-registry); proceed regardless.
  // See src/cli/commands/dup-remote-warn.ts.
  if (opts.gitRemote) {
    await warnIfDuplicateGitRemote(opts.gitRemote, abs);
  }

  const reg = await loadSkillRegistry(registryPath);
  const label = opts.label ?? `${opts.kind}:${abs}`;
  // addCatalog throws on label collision — let that propagate too (CLI handler converts to exit 1).
  const { registry: updated } = addCatalog(reg, {
    kind: opts.kind,
    rootPath: abs,
    label,
    ...(opts.gitRemote ? { gitRemote: opts.gitRemote } : {}),
  });
  await saveSkillRegistry(registryPath, updated);
  // Successful state mutation. Swallow log errors so a closed-stdout failure
  // doesn't make a caller think register failed.
  try {
    console.log(pc.green(`Registered skill catalog "${label}" at`), abs);
  } catch {
    /* ignore */
  }
}
