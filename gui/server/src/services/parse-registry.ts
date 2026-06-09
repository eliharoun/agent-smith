/**
 * parseRegistry accepts THREE on-disk shapes, in preference order:
 *
 *   1. GUI shape (plan-literal): { schemaVersion?, catalogs: { label: { path, agents: [...] } } }
 *      → returned as-is.
 *
 *   2. Legacy CLI shape (real registry written by the smith CLI today):
 *      { version: number, sources: [{ kind, rootPath, label, gitRemote? }, ...] }
 *      → translated into GUI shape. Each source becomes one catalog whose
 *      `agents` list is computed by scanning `rootPath` for subdirectories
 *      that contain an `agent.config.json` file.
 *
 *   3. Anything else → warn and return `{ catalogs: {} }` (self-heal).
 *
 * Rationale (Project Rule #8 — defensive hardening of plan-literal code):
 * the production registry at `~/.config/agent-smith/registry.json` uses the
 * legacy CLI shape, so without translation parseRegistry would silently
 * self-heal every real registry to empty. Translating here keeps Task 15
 * downstream code plan-literal.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";
import { discoverAgentBundleDirs } from "../../../../src/io/sources";
import { resolveSelfSource, SELF_SOURCE_LABEL } from "./self-source";

const GuiAgentRef = z.object({
  // Flat identity (no slashes) — used as the :name route param, URL segment,
  // and React key. Must satisfy the AGENT_NAME_PATTERN guard.
  name: z.string(),
  // Path of the bundle dir relative to the catalog `path`. For flat and
  // single-bundle layouts this equals `name`; for nested layouts it carries
  // the in-between dirs (e.g. "agents/my-agent"). Resolution is
  // always join(path, relPath).
  relPath: z.string(),
});

const GuiCatalog = z.object({
  path: z.string(),
  agents: z.array(GuiAgentRef),
});

// Note: `catalogs` is required (not defaulted) so that CLI-shaped JSON
// (which has no `catalogs` key) does NOT silently match GuiShape with an
// empty default — it must fall through to the CLI translation branch.
const GuiShape = z.object({
  schemaVersion: z.number().optional(),
  catalogs: z.record(z.string(), GuiCatalog),
});

const RemoteShape = z.object({
  url: z.string(),
  ref: z.string(),
  lastPulledSha: z.string().optional(),
  lastPulledAt: z.string().optional(),
  lastRemoteSha: z.string().optional(),
  lastCheckedAt: z.string().optional(),
});

const CliSource = z.object({
  kind: z.string(),
  rootPath: z.string(),
  label: z.string(),
  gitRemote: z.string().optional(),
  // [v1-task RC2-7] Provenance block for catalogs cloned via
  // `smith agent install --from <url>`. Presence drives mode=managed
  // in /api/catalogs.
  remote: RemoteShape.optional(),
});

const CliShape = z.object({
  // Accept both the canonical `schemaVersion` (v1-task B11.1 rename) and
  // the legacy `version` key the CLI emitted pre-B11.1. The CLI today
  // writes `schemaVersion: 2`; older installs may still have `version: 1`
  // on disk until the next mutation rewrites the file. The downstream
  // translator only cares about `sources`, so accept either key.
  schemaVersion: z.number().optional(),
  version: z.number().optional(),
  sources: z.array(CliSource),
});

export type Registry = z.infer<typeof GuiShape>;

/**
 * Raw CLI source entry as written by the smith CLI today. Exposed so callers
 * (e.g. /api/catalogs) can present the agent registry as a flat list of
 * sources alongside the skill registry, without converting to the GUI shape.
 *
 * GUI-shaped registries (no `sources` array) return an empty list.
 */
export interface RegistrySource {
  kind: string;
  rootPath: string;
  label: string;
  gitRemote?: string;
  // [v1-task RC2-7] Mirrors on-disk Source.remote. Exposed so /api/catalogs
  // can compute mode=managed/linked and propagate the drift block to the GUI.
  remote?: z.infer<typeof RemoteShape>;
}

export async function parseRegistrySources(
  path: string,
  options: ParseRegistryOptions = {},
): Promise<RegistrySource[]> {
  const explicitOptOut = options.includeSelf === false;
  const envOptOut = process.env.SMITH_DISABLE_SELF_SOURCE === "1";
  const includeSelf = !explicitOptOut && !envOptOut;
  const persisted = await parsePersistedRegistrySources(path);

  if (!includeSelf) return persisted;
  const self = await resolveSelfSource();
  if (self === null) return persisted;
  // Don't double-list if a persisted source already points at the same
  // rootPath as the synthetic self-source.
  if (persisted.some((s) => s.rootPath === self.rootPath)) return persisted;
  return [
    ...persisted,
    { kind: self.kind, rootPath: self.rootPath, label: self.label },
  ];
}

async function parsePersistedRegistrySources(path: string): Promise<RegistrySource[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[parse-registry] could not read ${path}: ${(err as Error).message}`);
    }
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.warn(`[parse-registry] invalid JSON in ${path}: ${(err as Error).message}`);
    return [];
  }
  const cli = CliShape.safeParse(json);
  if (cli.success) {
    return cli.data.sources.map((s) => {
      const base: RegistrySource = { kind: s.kind, rootPath: s.rootPath, label: s.label };
      if (s.gitRemote !== undefined) base.gitRemote = s.gitRemote;
      if (s.remote !== undefined) base.remote = s.remote;
      return base;
    });
  }
  return [];
}

export interface ParseRegistryOptions {
  /**
   * When true (default), prepends the synthetic "agent-smith-self" catalog
   * pointing at the running smith repo's bundled `agents/` directory.
   * Mirrors the CLI's resolveAllSources so the GUI surfaces the same
   * agents `smith agent list` does.
   *
   * Tests that want to assert only on registry-persisted catalogs can
   * pass `false` to suppress the synthetic injection.
   */
  includeSelf?: boolean;
}

export async function parseRegistry(
  path: string,
  options: ParseRegistryOptions = {},
): Promise<Registry> {
  const explicitOptOut = options.includeSelf === false;
  // Tests opt out of the self-source injection by setting
  // SMITH_DISABLE_SELF_SOURCE=1. This keeps fixture-driven assertions
  // from picking up the running agent-smith workspace's own agents/ dir.
  const envOptOut = process.env.SMITH_DISABLE_SELF_SOURCE === "1";
  const includeSelf = !explicitOptOut && !envOptOut;
  const persisted = await parsePersistedRegistry(path);

  if (!includeSelf) return persisted;

  // Inject the synthetic self-source if it resolves AND its rootPath
  // doesn't already collide with a persisted catalog (avoid double-listing
  // the same `agents/` dir).
  const self = await resolveSelfSource();
  if (self === null) return persisted;
  for (const c of Object.values(persisted.catalogs)) {
    if (c.path === self.rootPath) return persisted;
  }
  const selfCatalog = await resolveCatalogEntry(self.rootPath);
  return {
    ...persisted,
    catalogs: { ...persisted.catalogs, [SELF_SOURCE_LABEL]: selfCatalog },
  };
}

async function parsePersistedRegistry(path: string): Promise<Registry> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[parse-registry] could not read ${path}: ${(err as Error).message}`);
    }
    return { catalogs: {} };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.warn(`[parse-registry] invalid JSON in ${path}: ${(err as Error).message}`);
    return { catalogs: {} };
  }

  // 1. GUI shape — zero-translation fast path
  const gui = GuiShape.safeParse(json);
  if (gui.success) return gui.data;

  // 2. Legacy CLI shape — translate
  const cli = CliShape.safeParse(json);
  if (cli.success) {
    const catalogs: Record<string, z.infer<typeof GuiCatalog>> = {};
    for (const source of cli.data.sources) {
      const existing = catalogs[source.label];
      if (existing) {
        console.warn(
          `[parse-registry] duplicate label "${source.label}" in registry; keeping first (${existing.path}), ignoring duplicate (${source.rootPath})`,
        );
        continue;
      }
      catalogs[source.label] = await resolveCatalogEntry(source.rootPath);
    }
    return { catalogs };
  }

  // 3. Unknown shape
  console.warn(`[parse-registry] schema mismatch in ${path}; treating as empty`);
  return { catalogs: {} };
}

const bundleCache = new Map<string, { mtimeMs: number; bundles: z.infer<typeof GuiAgentRef>[] }>();
const bundleCacheStats = { hits: 0, misses: 0 };

/** Test-only: clear the bundle cache and reset stats. Do not call from production. */
export function __clearBundleCacheForTest(): void {
  bundleCache.clear();
  bundleCacheStats.hits = 0;
  bundleCacheStats.misses = 0;
}

/** Test-only: read bundle cache hit/miss counters. Do not call from production. */
export function __bundleCacheStatsForTest(): { hits: number; misses: number } {
  return { hits: bundleCacheStats.hits, misses: bundleCacheStats.misses };
}

/**
 * Translate a CLI source into the GUI catalog entry.
 *
 * Supports both shapes that arrive in the registry (DW-9):
 *
 *   1. Catalog shape — <rootPath>/<bundle>/agent.config.json. The
 *      catalog's `path` is `rootPath` and `agents` is the list of
 *      sub-bundle names. This is what `smith agent register <dir>`
 *      writes (multi-bundle dir).
 *   2. Single-bundle shape — <rootPath>/agent.config.json. The
 *      catalog's `path` is `dirname(rootPath)` and `agents` is the
 *      single name `basename(rootPath)`. Downstream code that does
 *      `join(info.path, bundleName)` therefore resolves back to
 *      `rootPath` unchanged. This is what `smith agent install
 *      --from <url>` writes (the natural shape of a `git clone` of
 *      a single-agent repo).
 *
 * If a rootPath happens to hold BOTH shapes simultaneously (hybrid),
 * both surface — the single-bundle takes the catalog path (so
 * join(info.path, basename) → rootPath works) and sub-bundles are
 * surfaced as additional names paired with the SAME catalog path,
 * which is wrong for them. We accept this as defensive best-effort;
 * the production CLI never produces a hybrid layout.
 *
 * Pre-DW-9 the single-bundle shape returned `{ path: rootPath,
 * agents: [] }`, so every remote-installed bundle was silently absent
 * from /api/agents and /api/catalogs. Same root-cause family as DW-2
 * (CLI listAgentDirs) and DW-5 (CLI sniffPath).
 */
async function resolveCatalogEntry(rootPath: string): Promise<z.infer<typeof GuiCatalog>> {
  const subBundles = await listAgentBundles(rootPath);
  const isSingleBundle = await fileExistsAt(join(rootPath, "agent.config.json"));
  if (isSingleBundle) {
    const single = basename(rootPath);
    // Single-bundle: catalog path is the PARENT so join(path, relPath) lands
    // on rootPath. The bundle's relPath is its basename (one segment).
    const selfRef = { name: single, relPath: single };
    if (subBundles.length === 0) {
      return { path: dirname(rootPath), agents: [selfRef] };
    }
    // Hybrid (CLI never emits this): the sub-bundles' relPaths were computed
    // relative to rootPath, but the catalog path is now dirname(rootPath), so
    // prefix them with the basename to keep join(path, relPath) correct.
    const rebased = subBundles.map((b) => ({ name: b.name, relPath: join(single, b.relPath) }));
    return {
      path: dirname(rootPath),
      agents: [...rebased, selfRef].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return { path: rootPath, agents: subBundles };
}

async function fileExistsAt(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function listAgentBundles(rootPath: string): Promise<z.infer<typeof GuiAgentRef>[]> {
  let dirStat: Awaited<ReturnType<typeof stat>>;
  try {
    dirStat = await stat(rootPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[parse-registry] could not stat ${rootPath}: ${(err as Error).message}`);
    }
    return [];
  }
  if (!dirStat.isDirectory()) return [];

  // Cache invalidation keys on rootPath's own mtime. Now that discovery is
  // recursive, a bundle added DEEP under rootPath (e.g. rootPath/agents/new/)
  // bumps the mtime of the intermediate dir but not rootPath's, so a runtime
  // add under an intermediate dir is missed until rootPath's mtime changes or
  // the server restarts. Acceptable: this layout/mutation is rare and a
  // restart recovers it; a deeper watch would be scope creep here.
  const cached = bundleCache.get(rootPath);
  if (cached && cached.mtimeMs === dirStat.mtimeMs) {
    bundleCacheStats.hits += 1;
    return cached.bundles;
  }
  bundleCacheStats.misses += 1;

  // Reuse the CLI's recursive discovery (single source of truth, parity with
  // `smith agent list`). discoverAgentBundleDirs returns ABSOLUTE bundle dirs,
  // including rootPath itself when it is a single-bundle. We translate to
  // {name, relPath}: name = basename(dir); relPath = dir relative to rootPath.
  // The single-bundle case (dir === rootPath) is handled by resolveCatalogEntry,
  // so we drop it here to avoid a "." relPath.
  const absDirs = await discoverAgentBundleDirs(rootPath);
  const bundles = absDirs
    .filter((abs) => abs !== rootPath)
    .map((abs) => ({ name: basename(abs), relPath: relative(rootPath, abs) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  bundleCache.set(rootPath, { mtimeMs: dirStat.mtimeMs, bundles });
  return bundles;
}
