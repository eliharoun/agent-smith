import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { SmithError } from "../../core/smith-error";
import { defaultRegistry, loadRegistry, saveRegistry } from "../../io/registry";
import { stateHome } from "../../io/state-home";
import { CANONICAL_USER_MD_TEMPLATE } from "../../io/user-template";

/**
 * Initialize an agent-smith install directory.
 *
 * Default `baseDir` is `stateHome()` — the XDG-aware canonical location
 * (`$XDG_CONFIG_HOME/agent-smith` if set; otherwise `~/.config/agent-smith`)
 * that the rest of the system expects. Tests pass an isolated tmpdir to
 * exercise the function hermetically; production callers (the CLI
 * dispatcher in src/index.ts) call `init()` with no args.
 *
 * Behavior pinned by tests/cli/init.test.ts:
 *   - creates `<baseDir>/agents/`
 *   - creates `<baseDir>/registry.json` (via saveRegistry round-trip)
 *   - creates `<baseDir>/USER.md` only if it does not already exist
 *   - does NOT create `<baseDir>/build/` (removed in commit f077248)
 *
 * Recovery semantics (CLI-5):
 *   `smith init` is the recovery tool, so it auto-recovers from a
 *   version-skewed registry OR a shape-invalid registry by overwriting
 *   it with the default. (Both classes are what the
 *   `registry-corrupt-shape`/`registry-version` remediations tell users
 *   to re-run `smith init` for.) All OTHER failure classes (corrupt
 *   JSON, EACCES, etc.) still propagate — silently overwriting a
 *   corrupt-JSON registry would risk trampling a file the user could
 *   have hand-edited.
 */
export async function init(baseDir: string = stateHome()): Promise<number> {
  await mkdir(join(baseDir, "agents"), { recursive: true });
  const registryPath = join(baseDir, "registry.json");
  const userPath = join(baseDir, "USER.md");
  let reg: Awaited<ReturnType<typeof loadRegistry>> | undefined;
  try {
    reg = await loadRegistry(registryPath);
  } catch (err) {
    if (err instanceof SmithError && err.payload.code === "registry-version") {
      console.warn(
        pc.yellow(
          `Existing registry at ${registryPath} has version ${err.payload.current} (expected ${err.payload.expected}); overwriting with default.`,
        ),
      );
      reg = defaultRegistry();
    } else if (err instanceof SmithError && err.payload.code === "registry-corrupt-shape") {
      console.warn(
        pc.yellow(
          `Existing registry at ${registryPath} has invalid contents; overwriting with default. Problems found:`,
        ),
      );
      for (const reason of err.payload.reasons) {
        console.warn(pc.yellow(`  - ${reason}`));
      }
      reg = defaultRegistry();
    } else {
      throw err;
    }
  }
  await saveRegistry(registryPath, reg);
  if (!(await Bun.file(userPath).exists())) {
    await Bun.write(userPath, CANONICAL_USER_MD_TEMPLATE);
  }
  console.log(pc.green("Initialized agent-smith at"), baseDir);
  return 0;
}
