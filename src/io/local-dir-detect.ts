import { stat } from "node:fs/promises";

/**
 * Returns true iff `s` resolves to an existing directory on disk.
 *
 * Used by the `smith agent install --from <s>` dispatcher to distinguish
 * a local-directory source from an archive path or a git URL. The order
 * of checks in the dispatcher is: archive → local-directory → git-URL,
 * so this helper assumes the input is NOT an archive path (the caller
 * already ruled that out).
 *
 * The protocol-prefix early-out keeps git URLs from accidentally hitting
 * `fs.stat` (which would fail anyway, but cleanly short-circuiting is
 * faster and clearer in the dispatcher's error path).
 *
 * Symlinks to directories count as directories (we use `stat`, not
 * `lstat`). Errors (ENOENT, EACCES, etc.) → false; we never throw.
 */
export async function isLocalDirectory(s: string): Promise<boolean> {
  if (s.length === 0) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return false;
  if (s.startsWith("git@") || s.startsWith("ssh://")) return false;
  try {
    const st = await stat(s);
    return st.isDirectory();
  } catch {
    return false;
  }
}
