import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads `<dir>/.git/config` and returns the `[remote "origin"]` URL.
 *
 * Used by the install pipeline to surface a sync-registration hint when
 * a local-directory install target is itself a git checkout. We parse
 * the INI directly rather than shelling out to `git` so we don't pay
 * a process-spawn per install and so we don't fail on systems without
 * `git` on PATH.
 *
 * Returns `undefined` for any of: no `.git/`, no `[remote "origin"]`
 * section, malformed config, I/O error. Never throws — this is an
 * advisory call, not a correctness boundary.
 */
export async function detectGitRemote(dir: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, ".git", "config"), "utf8");
  } catch {
    return undefined;
  }
  // Walk line-by-line. `[remote "origin"]` opens a section; the next
  // `url = ...` within that section is the answer. A new section header
  // closes the current one.
  const lines = raw.split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inOrigin = trimmed === '[remote "origin"]';
      continue;
    }
    if (!inOrigin) continue;
    const m = trimmed.match(/^url\s*=\s*(\S.*)$/);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}
