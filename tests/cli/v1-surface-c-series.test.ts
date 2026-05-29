// v1 surface stability — C-series CLI verbs.
//
// Locks the user-visible Commander surface (help text, flag set, descriptions)
// for the verbs introduced by the C-series (external-repo bundle sharing):
//
//   - `smith agent sync [name]` + `--all` + `--check`              (C3.11)
//   - `smith skill sync [name]` + `--all` + `--check`              (C3.12)
//   - `smith agent unregister <path> --purge-clone`                (C3.13)
//   - `smith skill unregister <path-or-label> --purge-clone`       (C3.13)
//   - `smith agent install ... --from <url> [--ref <ref>]`         (C3.9)
//
// Modelled on B9's surface-stability tests (`gui/server/src/v1-surface-*`).
// These verbs ship in v0.25.0 and become part of the frozen v1 surface; any
// unintentional drift to a flag name, argument arity, or description must
// fail the build until the maintainer acknowledges the change here.
//
// FAILURE RECOVERY — choose ONE before updating this snapshot:
//
//   1. If the change is accidental → revert it.
//   2. If the change is a v1 surface bug fix that maintains backwards
//      compatibility (e.g. typo, clearer wording) → update the snapshot in
//      the same commit as the fix.
//   3. If the change removes or renames a flag → MAJOR version bump required
//      (or a deprecation cycle on the old flag for at least one minor).
//   4. If the change adds a new flag → add it to the snapshot in the same
//      commit; new optional flags are forwards-compatible.
//
// The snapshot is the *full* `--help` output for each verb. We spawn a
// subprocess against an isolated `HOME` (matching `agent-wiring.test.ts`
// conventions) so the test never touches the maintainer's real config and
// works identically on macOS and Linux CI.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-v1-surface-c-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function help(...args: string[]): Promise<string> {
  // Strip XDG_* (see agent-wiring.test.ts for rationale).
  const env: Record<string, string> = { HOME: home };
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "HOME" || k.startsWith("XDG_") || v === undefined) continue;
    env[k] = v;
  }
  const proc = Bun.spawn(["bun", "src/index.ts", ...args, "--help"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  // Commander writes --help to stdout for the matched command; some
  // commander internals print version banners to stderr. We only assert
  // on stdout because that's the user-facing surface.
  return stdout;
}

describe("v1 surface — C-series verbs (locked from v0.25.0)", () => {
  test("`agent sync --help` is frozen", async () => {
    const out = await help("agent", "sync");
    expect(out).toBe(
      [
        "Usage: smith agent sync [options] [name]",
        "",
        "Pull updates for one or all remote-backed agent catalogs (v1-task C3.11)",
        "",
        "Options:",
        "  --all       Sync every remote-backed catalog",
        "  --check     Only probe remote HEAD (git ls-remote); do not touch working tree",
        "  -h, --help  display help for command",
        "",
      ].join("\n"),
    );
  });

  test("`skill sync --help` is frozen", async () => {
    const out = await help("skill", "sync");
    expect(out).toBe(
      [
        "Usage: smith skill sync [options] [name]",
        "",
        "Pull updates for one or all remote-backed skill catalogs (v1-task C3.12)",
        "",
        "Arguments:",
        "  name        skill catalog label or path (omit when using --all)",
        "",
        "Options:",
        "  --all       Sync every remote-backed skill catalog",
        "  --check     Only probe remote HEAD (git ls-remote); do not touch working tree",
        "  -h, --help  display help for command",
        "",
      ].join("\n"),
    );
  });

  test("`agent unregister --help` is frozen (includes --purge-clone)", async () => {
    const out = await help("agent", "unregister");
    expect(out).toBe(
      [
        "Usage: smith agent unregister [options] <path>",
        "",
        "Remove a registered agent catalog. Path is normalized like `register`.",
        "",
        "Options:",
        "  --purge-clone  Also delete the on-disk clone (only allowed for catalogs under",
        "                 <stateHome>/remote) [v1-task C3.13]",
        "  -h, --help     display help for command",
        "",
      ].join("\n"),
    );
  });

  test("`skill unregister --help` is frozen (includes --purge-clone)", async () => {
    const out = await help("skill", "unregister");
    expect(out).toBe(
      [
        "Usage: smith skill unregister [options] <path-or-label>",
        "",
        "Remove a registered skill catalog (rejects protected catalogs)",
        "",
        "Options:",
        "  --purge-clone  Also delete the on-disk clone (only allowed for catalogs under",
        "                 <stateHome>/remote) [v1-task C3.13]",
        "  -h, --help     display help for command",
        "",
      ].join("\n"),
    );
  });

  test("`agent install --help` advertises --from and --ref (C3.9)", async () => {
    // The full `agent install --help` text is large and exists in pre-C3
    // form already; we lock only the C-series additions here so other
    // unrelated flag tweaks on `install` don't churn this snapshot.
    //
    // Commander's column width depends on the longest flag name in the
    // command, which shifts when we add new flags (e.g. --platform-conventions
    // in Task 3.5). We assert on the flag presence + its description content
    // separately, with whitespace tolerance, so flag-list growth doesn't
    // churn this regression net.
    const out = await help("agent", "install");
    expect(out).toMatch(/--from <url>\s+Clone an external git repo containing the/);
    expect(out).toMatch(/\bregister it, then install\b/);
    expect(out).toMatch(/\(v1-task C3\.9\)/);
    expect(out).toMatch(/--ref <ref>\s+Git branch\/tag\/SHA to clone with --from/);
    expect(out).toMatch(/Defaults to\s+the remote's HEAD\./);
  });
});
