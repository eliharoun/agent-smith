// Subcommand factory for `smith agent catalog ...` (currently just `rename`).
// Mirror of src/cli/commands/skill/catalog-rename.ts adapted for the agent
// registry. Pulled out of src/index.ts so tests can mount the same wiring
// on a fresh Commander program with an overridden home directory.

import { Command } from "commander";
import pc from "picocolors";
import {
  canonicalRegistryPath,
  loadRegistry,
  renameSource,
  saveRegistry,
} from "../../../io/registry";
import { wrap, type WrapDeps } from "../../wrap";

export interface RegisterAgentCatalogOpts {
  /**
   * Test seam: override $HOME for the registry file path. Production callers
   * leave this unset and fall through to canonicalRegistryPath().
   */
  homeDirOverride?: string;
  /**
   * Test seam: override `wrap()`'s deps for every action registered here.
   * See install-cmd.ts / skill/catalog-rename.ts for rationale.
   */
  wrapDepsOverride?: WrapDeps;
}

function registryPathFor(home: string | undefined): string {
  return home
    ? `${home}/.config/agent-smith/registry.json`
    : canonicalRegistryPath();
}

export function registerAgentCatalogCommands(
  agentCmd: Command,
  opts: RegisterAgentCatalogOpts = {},
): void {
  const home = opts.homeDirOverride;
  const wrapDeps = opts.wrapDepsOverride;

  // `catalog` (singular) is the namespace for label-management subcommands
  // on registered agent catalogs (`rename`, and future mutating ops).
  // `catalogs` (plural) is a separate read-only listing command. This split
  // mirrors the `git remote` vs `git remote -v` pattern — plural for
  // inspection, singular as the parent of mutating subcommands. Both halves
  // are intentional and symmetric with the skill side
  // (src/cli/commands/skill/catalog-rename.ts).
  const catalogCmd = agentCmd
    .command("catalog")
    .description("Manage registered agent catalogs (rename, ...)");

  catalogCmd
    .command("rename <old-label> <new-label>")
    .description("Rename an agent catalog label")
    .action(
      wrap(
        "agent catalog rename",
        async (oldLabel: string, newLabel: string): Promise<number> => {
          const registryPath = registryPathFor(home);
          const reg = await loadRegistry(registryPath);
          const updated = renameSource(reg, oldLabel, newLabel);
          await saveRegistry(registryPath, updated);
          console.log(
            pc.green(`Renamed agent catalog "${oldLabel}" → "${newLabel}"`),
          );
          return 0;
        },
        wrapDeps,
      ),
    );
}
