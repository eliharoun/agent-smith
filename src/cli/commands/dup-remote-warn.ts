// src/cli/commands/dup-remote-warn.ts
//
// RC2-5: shared helper that warns (stderr) when a register operation's
// --git-remote URL matches an existing source/catalog in either registry.
// Returns void; the caller proceeds regardless. Contrast with RC2-4
// (install --from), which hard-errors on the same condition — register
// is opt-in alias creation, install is implicit catalog acquisition.

import pc from "picocolors";
import { sameGitRemote } from "../../io/git-url";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { canonicalSkillRegistryPath, loadSkillRegistry } from "../../io/skill-registry";

interface ExistingHit {
  kind: "agent" | "skill";
  label: string;
  rootPath: string;
}

/**
 * Scan both registries for entries pointing at `url`. Print one stderr
 * warning per hit. Excludes any entry at `selfRootPath` (the path being
 * registered) so re-registering the same path doesn't warn against
 * itself.
 */
export async function warnIfDuplicateGitRemote(
  url: string,
  selfRootPath: string,
): Promise<void> {
  const [agentReg, skillReg] = await Promise.all([
    loadRegistry(canonicalRegistryPath()),
    loadSkillRegistry(canonicalSkillRegistryPath()),
  ]);

  const hits: ExistingHit[] = [];
  for (const s of agentReg.sources) {
    if (s.rootPath === selfRootPath) continue;
    if (sameGitRemote(s.remote?.url, url) || sameGitRemote(s.gitRemote, url)) {
      hits.push({ kind: "agent", label: s.label, rootPath: s.rootPath });
    }
  }
  for (const c of skillReg.catalogs) {
    if (c.rootPath === selfRootPath) continue;
    if (sameGitRemote(c.remote?.url, url) || sameGitRemote(c.gitRemote, url)) {
      hits.push({ kind: "skill", label: c.label, rootPath: c.rootPath });
    }
  }

  for (const h of hits) {
    try {
      console.error(
        `${pc.yellow("⚠ ")}--git-remote ${url} already tracked by ${h.kind} catalog ` +
          `"${h.label}" at ${h.rootPath}. Registering anyway as an alias — both ` +
          `entries will resolve the same upstream.`,
      );
    } catch {
      /* swallow log failures; warning is informational */
    }
  }
}
