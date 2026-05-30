import { basename, dirname, sep } from "node:path";

/**
 * Derive a default catalog label from an absolute root directory path.
 *
 * Always uses `<parent>-<basename>` so labels describe location, not contents.
 * Strips a single leading dot from the parent segment so dotfile dirs
 * (e.g. `$HOME/.agent-smith/skills`) yield readable labels
 * (`agent-smith-skills`). If the parent resolves to the filesystem root,
 * falls back to the basename alone.
 *
 * No further sanitization is applied. Labels are display strings; they are
 * quoted in CLI output and stored verbatim in the registry JSON.
 */
export function deriveDefaultCatalogLabel(rootPath: string): string {
  // Tolerate a trailing separator so `/repo/skills` and `/repo/skills/`
  // produce the same label.
  const trimmed =
    rootPath.length > 1 && rootPath.endsWith(sep)
      ? rootPath.slice(0, -1)
      : rootPath;
  const base = basename(trimmed);
  const parentPath = dirname(trimmed);
  // dirname("/x") === "/" — treat that as "no meaningful parent".
  if (parentPath === sep || parentPath === "." || parentPath === "") {
    return base;
  }
  const parentBase = basename(parentPath);
  const parentClean = parentBase.startsWith(".")
    ? parentBase.slice(1)
    : parentBase;
  return `${parentClean}-${base}`;
}
