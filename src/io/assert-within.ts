import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { SmithError } from "../core/smith-error";

/**
 * Defense-in-depth path containment.
 *
 * `assertWithin(target, root)` resolves both paths to their canonical
 * (symlink-followed) form and throws `SmithError(validation-failed)` if
 * `target` is not `root` itself or a descendant of `root`.
 *
 * Use this as a belt-and-suspenders check at every filesystem write
 * site whose path is partially derived from user input (agent name,
 * source id, path argument). Even if the input-validation helper at
 * the CLI boundary fails to be called for some new entry point, this
 * catches the escape before any `mkdir`, `writeFile`, or `rm` happens.
 *
 * Resolution rules:
 *   - `root` MUST exist on disk. If it doesn't, that's a programmer
 *     error and we bubble the underlying ENOENT.
 *   - `target` MAY NOT exist yet — most call sites use this just before
 *     creating the path. We walk up to the deepest existing ancestor,
 *     `realpath` that, then re-append the descent. Symlinks in any
 *     existing prefix are followed.
 *   - All comparisons happen in canonical form. A symlink under `root`
 *     pointing outside `root` causes the target to NOT be within.
 *   - Containment is by path-segment, not string prefix: `/a/b` contains
 *     `/a/b/c` but does NOT contain `/a/bb`.
 *
 * Tracked under v1 task B6 (docs/2026-05-22-road-to-v1-checklist.md).
 *
 * @param target Path being operated on. May be absolute or relative
 *   (resolved against process cwd).
 * @param root Containment root. Must exist.
 * @throws SmithError({code:"validation-failed"}) if target escapes root.
 * @throws Underlying NodeJS.ErrnoException for IO failures on root.
 */
export async function assertWithin(target: string, root: string): Promise<void> {
  const canonicalRoot = await realpath(resolve(root));
  const canonicalTarget = await canonicalize(resolve(target));

  if (!isWithin(canonicalTarget, canonicalRoot)) {
    throw new SmithError({
      code: "validation-failed",
      what: "path containment check",
      reasons: [
        `target path "${target}" escapes containment root "${root}" (resolved to "${canonicalTarget}" vs root "${canonicalRoot}")`,
      ],
    });
  }
}

/**
 * Resolve a path's canonical form, tolerating non-existing tails.
 * Walks up to the deepest existing ancestor, realpaths that, then
 * re-appends the non-existing portion.
 */
async function canonicalize(absolutePath: string): Promise<string> {
  if (!isAbsolute(absolutePath)) {
    throw new Error(`canonicalize requires an absolute path; got ${absolutePath}`);
  }

  // Try the whole path first — fastest common case (target exists).
  try {
    return await realpath(absolutePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // Walk up to the deepest existing ancestor.
  const tail: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      // Hit filesystem root without finding anything that exists.
      // Should be impossible on a sane system (root "/" exists), but
      // re-throw rather than loop forever.
      throw new Error(`no existing ancestor for ${absolutePath}`);
    }
    tail.unshift(basenameOf(current));
    current = parent;
    try {
      const realParent = await realpath(current);
      return realParent + (tail.length > 0 ? sep + tail.join(sep) : "");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // Keep walking up.
    }
  }
}

function basenameOf(p: string): string {
  // node:path's basename, inlined to avoid importing the whole module
  // surface for one call.
  const idx = p.lastIndexOf(sep);
  return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * True when `child` is `parent` or a descendant. Segment-aware:
 * `/a/b` contains `/a/b/c` but NOT `/a/bb`.
 */
function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(withSep);
}
