// Subcommand factory for `smith skill catalog ...` (currently just `rename`).
// Pulled out of src/index.ts so tests can mount the same wiring on a fresh
// Commander program with overridden home — matching the pattern used by
// registerSkillInstallCommands in ./install-cmd.ts.

import { Command } from "commander";
import pc from "picocolors";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  renameCatalog,
  saveSkillRegistry,
} from "../../../io/skill-registry";
import { wrap, type WrapDeps } from "../../wrap";

export interface RegisterSkillCatalogOpts {
  /**
   * Test seam: override $HOME for the registry file path. Production callers
   * leave this unset and fall through to canonicalSkillRegistryPath().
   */
  homeDirOverride?: string;
  /**
   * Test seam: override `wrap()`'s deps for every action registered here.
   * See install-cmd.ts for the rationale (avoid killing the bun-test runner
   * via process.exit on success).
   */
  wrapDepsOverride?: WrapDeps;
}

function registryPathFor(home: string | undefined): string {
  return home
    ? `${home}/.config/agent-smith/skill-catalogs.json`
    : canonicalSkillRegistryPath();
}

export function registerSkillCatalogCommands(
  skillCmd: Command,
  opts: RegisterSkillCatalogOpts = {},
): void {
  const home = opts.homeDirOverride;
  const wrapDeps = opts.wrapDepsOverride;

  // `catalog` (singular) is the namespace for label-management subcommands
  // on registered skill catalogs (`rename`, and future mutating ops).
  // `catalogs` (plural) is a separate read-only listing command. This split
  // mirrors the `git remote` vs `git remote -v` pattern — plural for
  // inspection, singular as the parent of mutating subcommands. Both halves
  // are intentional and symmetric with the agent side
  // (src/cli/commands/agent/catalog-rename.ts).
  const catalogCmd = skillCmd
    .command("catalog")
    .description("Manage registered skill catalogs (rename, ...)");

  catalogCmd
    .command("rename <old-label> <new-label>")
    .description("Rename a skill catalog label")
    .action(
      wrap(
        "skill catalog rename",
        async (oldLabel: string, newLabel: string): Promise<number> => {
          const registryPath = registryPathFor(home);
          const reg = await loadSkillRegistry(registryPath);
          const updated = renameCatalog(reg, oldLabel, newLabel);
          await saveSkillRegistry(registryPath, updated);
          console.log(
            pc.green(`Renamed skill catalog "${oldLabel}" → "${newLabel}"`),
          );
          return 0;
        },
        wrapDeps,
      ),
    );
}
