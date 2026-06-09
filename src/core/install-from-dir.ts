import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { detectGitRemote } from "../io/git-remote-detect";
import { defaultRemoteRoot } from "../io/remote-root";
import { addSource, canonicalRegistryPath, loadRegistry, saveRegistry } from "../io/registry";
import { scanBundleNames } from "./install-from-url";
import { SmithError } from "./smith-error";
import type { Source } from "./types";

export interface InstallFromDirOptions {
  /** Absolute path to a local directory containing one or more bundles. */
  localPath: string;
  /** Test seam: override the registry path so tests don't touch global state. */
  registryPath?: string;
}

export interface InstallFromDirResult {
  catalogRootPath: string;
  bundles: string[];
  /** When the directory is a git checkout, the upstream URL (advisory; not auto-registered). */
  detectedGitRemote?: string;
}

/**
 * Register a local directory as a `kind: registered` catalog and return the
 * discovered bundle names. Mirrors `installFromArchive` in shape — verify,
 * register, return — minus the clone step.
 *
 * Refuses:
 *  - paths inside `<XDG_STATE_HOME>/agent-smith/remote/` (smith-managed
 *    clones; install from the upstream URL instead)
 *  - paths whose `rootPath` is already registered (the caller can either
 *    install by name from the existing catalog, or unregister first)
 *  - paths containing no `agent.config.json` files
 *
 * The `detectedGitRemote` field is advisory: smith never auto-registers
 * the remote. The CLI verb (Task 5) prints a hint suggesting
 * `smith agent register --git-remote` for users who want sync.
 */
export async function installFromDir(opts: InstallFromDirOptions): Promise<InstallFromDirResult> {
  const abs = resolve(opts.localPath);

  // Refuse smith-managed clones — those should be installed via --from <git-url>.
  const remoteRoot = resolve(defaultRemoteRoot());
  if (abs === remoteRoot || abs.startsWith(remoteRoot + "/")) {
    throw new SmithError({
      code: "validation-failed",
      what: "install --from",
      reasons: [
        `${abs} is inside smith's managed-clones directory (<stateHome>/remote/). Install from the upstream URL instead.`,
      ],
    });
  }

  const regPath = opts.registryPath ?? canonicalRegistryPath();
  const reg = await loadRegistry(regPath);

  // Early duplicate check on the user-provided path. This handles the flat
  // layout (where abs === catalogRootPath) and also lets us surface a stale
  // hint for previously-registered flat catalogs even when the directory no
  // longer exists (so scanBundleNames would return nothing).
  const earlyExisting = reg.sources.find((s) => s.rootPath === abs);
  if (earlyExisting) {
    let staleHint = "";
    try {
      await stat(earlyExisting.rootPath);
    } catch {
      staleHint = ` That path no longer exists; if it's stale, run \`smith agent unregister ${earlyExisting.label}\` first.`;
    }
    throw new SmithError({
      code: "validation-failed",
      what: "install --from",
      reasons: [
        `${abs} is already registered as catalog "${earlyExisting.label}".${staleHint}`,
      ],
    });
  }

  // Discover bundles. scanBundleNames walks for agent.config.json and skips
  // .git/ + node_modules. Both single-bundle and catalog layouts work.
  const bundles = await scanBundleNames(abs, "agent");
  if (bundles.length === 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "install --from",
      reasons: [`no agent bundles (no agent.config.json) found under ${abs}`],
    });
  }

  // Register the directory the user passed, verbatim, as the catalog root.
  // Recursive listAgentDirs discovers bundles at any depth underneath
  // (single-bundle, flat <dir>/<name>/, or nested <dir>/agents/<name>/), so
  // no rootPath rebasing is needed. Keeping rootPath = the passed dir means
  // it remains a valid git working tree for any later sync/purge operations.
  const catalogRootPath = abs;
  const label = catalogRootPath.split("/").filter(Boolean).pop() ?? "local-catalog";
  const newSource: Source = {
    kind: "registered",
    rootPath: catalogRootPath,
    label,
  };
  const addResult = addSource(reg, newSource);
  if (addResult.status !== "added") {
    throw new SmithError({
      code: "validation-failed",
      what: "install --from",
      reasons: [
        `${catalogRootPath} is already registered as catalog "${addResult.existingLabel}".`,
      ],
    });
  }
  await saveRegistry(regPath, addResult.registry);

  const detectedGitRemote = await detectGitRemote(abs);
  return {
    catalogRootPath,
    bundles,
    ...(detectedGitRemote !== undefined ? { detectedGitRemote } : {}),
  };
}
