/** Glob metacharacters that terminate a pattern's "static prefix". Includes `!` and `()`, which are treated conservatively (bail to a broader prefix) even where a given glob dialect wouldn't — safe for a prefilter. */
const GLOB_META = /[*?[\]{}!()]/;

/**
 * Derive a conservative set of sparse-checkout paths from a git knowledge
 * source's `subpath` + `include` filters.
 *
 * The contract: the returned paths are a COARSE network-saving prefilter. The
 * caller's picomatch walk remains the precise gate. We extract the broadest
 * *static* path prefix of each glob and never risk under-fetching:
 *
 *   - If `include` is set and EVERY pattern has a usable static prefix, return
 *     those prefixes (subpath-composed, deduped, descendants collapsed).
 *   - If ANY include pattern has no static prefix (e.g. "**\/*.md", "*.json"),
 *     return [] ("no-sparse") so the caller clones the whole repo shallow.
 *   - If `include` is absent but `subpath` is set, return ["/<subpath>/"].
 *   - If both are absent, return [] ("no-sparse").
 *
 * Returned paths use a leading "/" (anchored to repo root) and a trailing "/"
 * for directories, matching git sparse-checkout --no-cone gitignore-style
 * patterns. A literal file pattern keeps no trailing slash.
 */
export function sparsePathsFor(subpath?: string, include?: string[]): string[] {
  const base = normalizeSegment(subpath);

  if (!include || include.length === 0) {
    if (base === "") return [];
    return [`/${base}/`];
  }

  const prefixes: string[] = [];
  for (const pattern of include) {
    const prefix = staticPrefix(pattern);
    if (prefix === null) {
      // A prefix-less pattern means we cannot safely narrow the download
      // without risking under-fetch. Fall back to whole-repo.
      return [];
    }
    const composed = [base, prefix.path].filter((s) => s.length > 0).join("/");
    prefixes.push(prefix.isFile ? `/${composed}` : `/${composed}/`);
  }

  return collapse(prefixes);
}

/** Static-prefix result: the glob-free leading path + whether the whole
 *  pattern is a literal file path. */
interface PrefixInfo {
  /** The static path prefix (no globs), POSIX-joined, no leading/trailing slash. */
  path: string;
  /** True when the WHOLE pattern is a literal path (no glob anywhere). */
  isFile: boolean;
}

/**
 * Return the static leading path of a glob (the longest run of leading
 * segments containing no glob metacharacter), or null if there is none.
 */
function staticPrefix(pattern: string): PrefixInfo | null {
  const segments = pattern.split("/").filter((s) => s.length > 0);
  const staticSegs: string[] = [];
  let sawGlob = false;
  for (const seg of segments) {
    if (GLOB_META.test(seg)) {
      sawGlob = true;
      break;
    }
    staticSegs.push(seg);
  }
  if (staticSegs.length === 0) return null;
  const path = staticSegs.join("/");
  const isFile = !sawGlob && staticSegs.length === segments.length;
  return { path, isFile };
}

/** Strip leading/trailing slashes and collapse a subpath segment to "" when empty. */
function normalizeSegment(p?: string): string {
  if (!p) return "";
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Dedupe and remove any path that is a descendant of another in the set
 * (keep the broadest). Paths are compared as directory prefixes.
 */
function collapse(paths: string[]): string[] {
  const uniq = Array.from(new Set(paths)).sort();
  const out: string[] = [];
  for (const p of uniq) {
    const pDir = p.endsWith("/") ? p : `${p}/`;
    const covered = out.some((kept) => {
      const keptDir = kept.endsWith("/") ? kept : `${kept}/`;
      return pDir.startsWith(keptDir);
    });
    if (!covered) out.push(p);
  }
  return out;
}
