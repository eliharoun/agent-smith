import { lstat, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstalledStatus, Platform } from "gui-shared";

/**
 * Mirror of the smith CLI's per-platform install layout. Source of truth:
 * - Roots: `src/cli/install-paths.ts:6-12` (`defaultInstallPaths()`).
 * - Filename layout: `src/io/installer.ts:31-39` (`targetPath()`):
 *     - `opencode`/`claude-code`: `<root>/<agent>.md` (a file)
 *     - `codex`:                  `<root>/<agent>/SKILL.md` (a file)
 *
 * Returned strings are the *artifact paths the CLI writes*, suitable for
 * direct existence probing (see `computeInstalledStatus`). Same convention
 * as `gui/server/src/services/refresh-manifest.ts:7` — duplicate the value
 * here rather than importing from `src/cli/install-paths.ts` to keep the
 * GUI server free of runtime coupling to the CLI source tree. A test in
 * `installed-status.test.ts` asserts parity with the CLI.
 */
export function defaultInstallPaths(agent: string): Record<Platform, string> {
  const home = homedir();
  return {
    opencode: join(home, ".config", "opencode", "agents", `${agent}.md`),
    "claude-code": join(home, ".claude", "agents", `${agent}.md`),
    codex: join(home, ".agents", "skills", agent, "SKILL.md"),
    kiro: join(home, ".kiro", "agents", `${agent}.json`),
  };
}

export interface ComputeInput {
  agent: string;
  paths: Record<Platform, string>;
}

/**
 * Probe a single install-artifact path. Returns `true` only when the path
 * resolves to a regular file (following symlinks one hop). Distinguishes
 * three error modes deterministically:
 *
 *  - ENOENT (or symlink target ENOENT) → silent `false`. This is the normal
 *    "agent not installed" case and must not pollute the operator's logs.
 *  - non-file types (dirs, sockets, …) → silent `false`. Every CLI install
 *    artifact is a file; anything else at that path is broken state, not an
 *    install.
 *  - EACCES / unexpected errnos → `false` BUT `console.warn` so a misconfigured
 *    parent dir can be diagnosed instead of silently masquerading as
 *    "not installed". We never throw — partial status is more useful than
 *    a 500 from the GUI server.
 *
 * Replaces an earlier `Bun.file(p).exists()` probe whose stat-vs-lstat
 * semantics were platform-dependent for non-file entries.
 */
async function probeOne(p: string): Promise<boolean> {
  try {
    const st = await lstat(p);
    if (st.isFile()) return true;
    if (st.isSymbolicLink()) {
      try {
        const target = await stat(p);
        return target.isFile();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return false; // dangling symlink
        console.warn(`[installed-status] cannot follow symlink ${p}: ${(err as Error).message}`);
        return false;
      }
    }
    return false; // directory, socket, fifo, etc.
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    console.warn(`[installed-status] cannot stat ${p}: ${(err as Error).message}`);
    return false;
  }
}

export async function computeInstalledStatus(input: ComputeInput): Promise<InstalledStatus> {
  const entries = await Promise.all(
    (Object.entries(input.paths) as Array<[Platform, string]>).map(async ([platform, p]) => {
      const exists = await probeOne(p);
      return [platform, exists] as const;
    }),
  );
  const installed = Object.fromEntries(entries) as Record<Platform, boolean>;
  return { agent: input.agent, installed };
}
