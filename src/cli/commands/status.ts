import pc from "picocolors";
import { canonicalRegistryPath, canonicalUserPath, loadRegistry } from "../../io/registry";
import { canonicalSkillRegistryPath, loadSkillRegistry } from "../../io/skill-registry";
import { detectRc1Clones } from "./migrate-clones";

export interface StatusPaths {
  /** Override for tests. Defaults to canonicalRegistryPath(). */
  registryPath?: string;
  /** Override for tests. Defaults to canonicalSkillRegistryPath(). */
  skillRegistryPath?: string;
}

export async function status(paths: StatusPaths = {}): Promise<number> {
  const registryPath = paths.registryPath ?? canonicalRegistryPath();
  const skillRegistryPath = paths.skillRegistryPath ?? canonicalSkillRegistryPath();

  console.log(pc.bold("agent-smith status"));
  console.log("Registry:", registryPath);
  console.log("USER.md: ", canonicalUserPath());

  const reg = await loadRegistry(registryPath);
  console.log(`Agent catalogs (${reg.sources.length}):`);
  if (reg.sources.length === 0) {
    console.log(pc.dim("  (none)"));
  } else {
    for (const s of reg.sources) {
      console.log(`  - [${s.kind}] ${s.rootPath} (${s.label})`);
    }
  }

  const skillReg = await loadSkillRegistry(skillRegistryPath);
  console.log(`Skill catalogs (${skillReg.catalogs.length}):`);
  if (skillReg.catalogs.length === 0) {
    console.log(pc.dim("  (none)"));
  } else {
    for (const c of skillReg.catalogs) {
      const flags: string[] = [];
      if (c.protected) flags.push("protected");
      if (c.adhoc) flags.push("adhoc");
      const flagStr = flags.length ? pc.dim(` [${flags.join(", ")}]`) : "";
      console.log(`  - [${c.kind}] ${c.rootPath} (${c.label})${flagStr}`);
    }
  }

  // rc.1 → rc.2+ clone-location nudge: surface a one-line hint when any
  // registered catalog still lives under the rc.1 location ($XDG_CONFIG_HOME).
  // Pure detection — no mutation. The hint points at `smith migrate-clones`
  // for the actual move.
  const rc1 = await detectRc1Clones({ registryPath, skillRegistryPath });
  if (rc1.count > 0) {
    console.log("");
    console.log(
      pc.yellow(
        `! ${rc1.count} catalog(s) still on the rc.1 clone location ($XDG_CONFIG_HOME/agent-smith/remote/...).`,
      ),
    );
    console.log(pc.yellow(`  Run \`smith migrate-clones\` to move them under $XDG_STATE_HOME.`));
  }

  return 0;
}
