import { resolve, dirname } from "node:path";
import { stat } from "node:fs/promises";
import pc from "picocolors";
import { SmithError } from "../../core/smith-error";
import type { SourceKind } from "../../core/types";
import { addSource, canonicalRegistryPath, loadRegistry, saveRegistry } from "../../io/registry";
import {
  defaultRunGit,
  type GitRunner,
  sniffPath,
  verifyGitRemote,
} from "../registry-validation";
import { warnIfDuplicateGitRemote } from "./dup-remote-warn";

export interface RegisterOptions {
  kind: SourceKind;
  label?: string;
  gitRemote?: string;
  /** Bypass the "no agent bundles" error. Default: false. */
  allowEmpty?: boolean;
  /** Bypass the git-repo / remote-URL check. Default: false. */
  skipGitCheck?: boolean;
  /** Test seam. Defaults to canonicalRegistryPath(). */
  registryPath?: string;
  /** Test seam. Defaults to defaultRunGit. */
  runGit?: GitRunner;
}

async function isBundleDir(path: string): Promise<boolean> {
  try {
    const s = await stat(`${path}/agent.config.json`);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function register(rootPath: string, opts: RegisterOptions): Promise<number> {
  const abs = resolve(rootPath);
  const registryPath = opts.registryPath ?? canonicalRegistryPath();
  const runGit = opts.runGit ?? defaultRunGit;

  const sniff = await sniffPath(abs);
  if (!sniff.exists) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent catalog",
      reasons: [`path ${abs} does not exist`],
    });
  }
  if (sniff.agentBundles === 0 && sniff.skillBundles > 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent catalog",
      reasons: [
        `path ${abs} looks like a skill catalog (found ${sniff.skillBundles} SKILL.md ${sniff.skillBundles === 1 ? "file" : "files"}, 0 agent.config.json)`,
        "Did you mean `smith skill register`?",
      ],
      suggestedCommand: `smith skill register ${abs} --kind <kind> --label <label>`,
    });
  }
  if (sniff.agentBundles === 0 && !opts.allowEmpty) {
    if (await isBundleDir(abs)) {
      const parent = dirname(abs);
      throw new SmithError({
        code: "validation-failed",
        what: "agent catalog",
        reasons: [
          `path ${abs} is a single agent bundle, not a catalog (a catalog contains subdirectories with agent.config.json)`,
          "Did you mean to register the parent directory? Bundles inside registered roots are auto-discovered — no per-bundle register is needed.",
        ],
        suggestedCommand: `smith agent register ${parent} --kind ${opts.kind}${opts.label ? ` --label ${opts.label}` : ""}`,
      });
    }
    throw new SmithError({
      code: "validation-failed",
      what: "agent catalog",
      reasons: [
        `path ${abs} contains no agent bundles (no subdirectories with agent.config.json)`,
        "Use --allow-empty to register anyway.",
      ],
      suggestedCommand: `smith agent register ${abs} --kind ${opts.kind}${opts.label ? ` --label ${opts.label}` : ""} --allow-empty`,
    });
  }

  if (opts.gitRemote && !opts.skipGitCheck) {
    const verify = await verifyGitRemote(abs, opts.gitRemote, runGit);
    if (!verify.ok) {
      if (verify.reason === "not-a-git-repo") {
        throw new SmithError({
          code: "validation-failed",
          what: "agent catalog",
          reasons: [`path ${abs} is not a git repository`],
          suggestedCommand: `smith agent register ${abs} --kind ${opts.kind} --git-remote ${opts.gitRemote} --skip-git-check`,
        });
      }
      const found = verify.found.map((r) => `${r.name} -> ${r.url}`).join(", ") || "(no remotes)";
      throw new SmithError({
        code: "validation-failed",
        what: "agent catalog",
        reasons: [
          `--git-remote ${opts.gitRemote} does not match any remote of ${abs}`,
          `found: ${found}`,
        ],
      });
    }
  }

  // RC2-5: warn (but proceed) when --git-remote URL already tracked
  // elsewhere. Register is opt-in alias creation; install --from
  // (RC2-4) hard-errors on the same condition.
  if (opts.gitRemote) {
    await warnIfDuplicateGitRemote(opts.gitRemote, abs);
  }

  const reg = await loadRegistry(registryPath);
  const label = opts.label ?? `${opts.kind}:${abs}`;
  const addResult = addSource(reg, {
    kind: opts.kind,
    rootPath: abs,
    label,
    ...(opts.gitRemote ? { gitRemote: opts.gitRemote } : {}),
  });
  if (addResult.status === "noop-different-label") {
    console.error(
      `${pc.yellow("⚠ ")}Catalog at ${abs} is already registered as ` +
        `"${addResult.existingLabel}"; --label "${label}" was ignored.\n` +
        `  Use 'smith agent catalog rename ${addResult.existingLabel} <new-label>' ` +
        `to change the label.`,
    );
  }
  if (addResult.status === "added") {
    await saveRegistry(registryPath, addResult.registry);
    console.log(pc.green("Registered agent catalog at"), abs);
  } else {
    // noop-same-label or noop-different-label: the catalog was already
    // registered, so don't print a green "registered" line that would
    // contradict the warning (or imply we did work we didn't do).
    console.log(pc.dim("Agent catalog already registered at"), abs);
  }
  return 0;
}
