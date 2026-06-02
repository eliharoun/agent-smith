import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dump } from "js-yaml";
import { stateHome } from "./state-home";
import { atomicWriteText } from "./atomic-write";
import type { InstallPaths, RenderedAgent, Target } from "../core/types";
import { SmithError } from "../core/smith-error";
import { assertWithin } from "./assert-within";
import { withFileLock } from "./git-lock";
import {
  addInstalledAgent,
  hashContent,
  type InstalledAgentsFile,
  loadInstalledAgents,
  saveInstalledAgents,
} from "./installed-agents";

// Re-export for backward compat with prior import paths. New code should
// import `InstallPaths` directly from `core/types`.
export type { InstallPaths } from "../core/types";

export interface InstallResult {
  installed: InstallEntry[];
  /**
   * Renders whose target file already contained byte-identical content and
   * therefore did NOT incur a write. Surfaced separately so the CLI can
   * report "N installed, M unchanged" instead of misleading the user about
   * how much actually changed on disk. Lazy-claim entries (file was
   * pre-existing and matched smith's render exactly) also land here.
   */
  skipped: InstallEntry[];
  warnings: string[];
}

/**
 * One install/skip outcome. `agent` was added when the install output
 * formatter needed to group entries by bundle name; it's optional for
 * backward compatibility with callers that don't fill it in.
 */
export interface InstallEntry {
  target: Target;
  path: string;
  agent?: string;
}

export interface InstallRenderedOpts {
  /**
   * Test seam for the installed-agents manifest's home dir. Production
   * omits and gets `stateHome()` (honors XDG_CONFIG_HOME).
   */
  homeDir?: string;
  /**
   * Bypass the would-clobber refusal. Use for:
   *  - overwriting a non-smith file at the destination
   *  - re-claiming a manifest entry whose recorded path no longer matches
   *    the new render's relativePath (bundle rename or translator change)
   */
  force?: boolean;
}

/**
 * Deep-sort object keys for deterministic JSON serialization. Required so
 * the manifest's hash-match idempotency check sees byte-identical output
 * across runs given identical input. Existing YAML serialization is
 * already deterministic via js-yaml's `sortKeys: true`.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
  }
  return out;
}

function serialize(rendered: RenderedAgent): string {
  if (rendered.format === "json") {
    return `${JSON.stringify(sortKeysDeep(rendered.data), null, 2)}\n`;
  }
  // markdown-frontmatter
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(rendered.frontmatter).sort()) {
    sorted[k] = rendered.frontmatter[k];
  }
  const fm = dump(sorted, { lineWidth: 0, sortKeys: true });
  return `---\n${fm}---\n\n${rendered.body}`;
}

function targetPath(rendered: RenderedAgent, paths: InstallPaths): string {
  return join(paths[rendered.target], rendered.relativePath);
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function manifestLockPath(homeDir?: string): string {
  // Sibling lockfile so withFileLock's wx-create doesn't collide with the
  // manifest itself. The lock is held only for the read-modify-write cycle.
  const root = homeDir ? join(homeDir, ".config/agent-smith") : stateHome();
  return join(root, "installed-agents.json.lock");
}

/**
 * Kiro-specific: scan `<paths.kiro>/*.json` for files declaring the same
 * top-level `name` field as the bundle being installed at a DIFFERENT
 * filename. Returns absolute paths of every conflicting file.
 *
 * Tool-agnostic — observes the public `name` field only, no AIM sentinels
 * or tool-specific metadata. The kiro runtime keys agents by their
 * `name` field, so two files declaring the same `name` produce undefined
 * runtime behavior regardless of who wrote them.
 *
 * Quietly tolerates malformed JSON, unreadable files, and missing dirs —
 * those aren't smith's problem.
 */
async function scanKiroNameCollision(
  kiroAgentsDir: string,
  bundleName: string,
  ourFilename: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(kiroAgentsDir);
  } catch {
    return [];
  }
  const collisions: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    if (entry === ourFilename) continue; // our own file
    const path = join(kiroAgentsDir, entry);
    try {
      const raw = await readFile(path, "utf8");
      const data = JSON.parse(raw) as { name?: unknown };
      if (typeof data.name === "string" && data.name === bundleName) {
        collisions.push(path);
      }
    } catch {
      // Malformed JSON or unreadable file — not our concern.
    }
  }
  return collisions;
}

/**
 * Bundle name from the rendered agent. Inferred from `relativePath`:
 *   "<name>.md"          → <name>            (opencode, claude-code)
 *   "<name>.json"        → <name>            (kiro)
 *   "<name>/SKILL.md"    → <name>            (codex)
 */
function inferBundleName(rendered: RenderedAgent): string {
  const rp = rendered.relativePath;
  if (rp.endsWith("/SKILL.md")) return rp.slice(0, -"/SKILL.md".length);
  if (rp.endsWith(".json")) return rp.slice(0, -".json".length);
  if (rp.endsWith(".md")) return rp.slice(0, -".md".length);
  return rp;
}

/**
 * Install a list of rendered agents to their target platforms.
 *
 * Manifest-aware: every per-target write consults
 * `~/.config/agent-smith/installed-agents.json` to:
 *  - Skip byte-identical re-installs (idempotent reinstall path).
 *  - Lazy-claim pre-existing files whose content matches smith's render
 *    (silent migration from pre-manifest state).
 *  - Refuse to overwrite foreign files (would-clobber); `--force` overrides.
 *  - Refuse to overwrite a smith-managed file at a different path
 *    (manifest path mismatch — bundle rename or translator change);
 *    `--force` re-claims the new path.
 *  - Warn (without refusing) when an owned file's hash drifted since
 *    smith last wrote it (external edit by user or another tool).
 *
 * The manifest read-modify-write cycle is wrapped in `withFileLock` so
 * concurrent installs of *different* agents don't race on the manifest write.
 * Per-agent install ordering is the caller's responsibility (orchestrator
 * already serializes by precedence).
 */
export async function installRendered(
  rendered: RenderedAgent[],
  paths: InstallPaths,
  opts: InstallRenderedOpts = {},
): Promise<InstallResult> {
  const installed: InstallResult["installed"] = [];
  const skipped: InstallResult["skipped"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, RenderedAgent>();

  await withFileLock(manifestLockPath(opts.homeDir), async () => {
    let manifest = await loadInstalledAgents(
      opts.homeDir ? { homeDir: opts.homeDir } : undefined,
    );

    for (const r of rendered) {
      const dedupKey = `${r.target}:${r.relativePath}`;
      const winner = seen.get(dedupKey);
      if (winner) {
        const winnerSrc = winner.bundlePath ? ` (kept: ${winner.bundlePath})` : "";
        warnings.push(
          `Skipped duplicate ${r.relativePath} for target ${r.target} (already installed by higher-precedence source)${winnerSrc}`,
        );
        continue;
      }
      seen.set(dedupKey, r);

      const path = targetPath(r, paths);
      const installRoot = paths[r.target];
      await mkdir(installRoot, { recursive: true });
      await assertWithin(path, installRoot);

      const next = serialize(r);
      const newHash = hashContent(next);
      const bundleName = inferBundleName(r);

      // Find the MAIN-file entry for this (name, platform). Sidecar
      // entries (kind: "sidecar") are independently tracked and don't
      // participate in path-mismatch / external-modification checks for
      // the main render. `kind` was added alongside sidecar support;
      // entries written before that are treated as main (kind === undefined).
      const entry = manifest.installed.find(
        (e) =>
          e.platform === r.target &&
          e.name === bundleName &&
          (e.kind === "main" || e.kind === undefined),
      );

      // Kiro-specific: scan for same-name-different-filename collisions.
      // Two kiro agent files declaring the same top-level `name` produce
      // undefined runtime behavior (kiro-cli agent list will show two
      // entries; which one wins on invocation is not specified).
      //   First install (no manifest entry)  → refuse with actionable error
      //   Reinstall  (manifest entry exists) → warn but proceed
      // Tool-agnostic — observes the public `name` field only, no AIM /
      // kiro-lens sentinel detection.
      if (r.target === "kiro") {
        const ourFilename = `${bundleName}.json`;
        const collisions = await scanKiroNameCollision(
          paths.kiro,
          bundleName,
          ourFilename,
        );
        if (collisions.length > 0) {
          const message =
            `Another agent file at ${collisions[0]} already declares name '${bundleName}'. ` +
            `kiro-cli will see two agents with the same name; behavior is undefined.`;
          if (entry === undefined) {
            // First install — refuse to add to the conflict.
            throw new SmithError({
              code: "already-exists",
              what: "kiro agent name collision",
              identifier: collisions[0]!,
              suggestedCommand: `smith agent destroy ${bundleName} && smith agent init <new-name> --from ${bundleName}`,
            });
          }
          // Reinstall — the conflict already exists; smith refusing doesn't
          // fix it. Warn the user; proceed with the requested update of
          // smith's own file.
          warnings.push(`[${bundleName}/kiro] ${message}`);
        }
      }

      const onDisk = await readIfExists(path);

      // Path 1: manifest entry exists at the same path → idempotent
      if (entry !== undefined && entry.path === path) {
        if (onDisk !== undefined && onDisk === next) {
          // Byte-identical: no write
          skipped.push({ target: r.target, path, agent: bundleName });
          // Even when the main file is unchanged, sidecars may have been
          // added or modified — process them on the same pass so
          // freshly-declared mcpServers produce a sidecar without forcing
          // the user to mutate the main render. writeSidecars is itself
          // hash-idempotent and returns the updated manifest copy.
          manifest = await writeSidecars(r, paths, bundleName, manifest);
          continue;
        }
        if (onDisk !== undefined) {
          const currentHash = hashContent(onDisk);
          if (currentHash !== entry.contentHash) {
            warnings.push(
              `[${bundleName}/${r.target}] file at ${path} was modified externally since smith installed it; overwriting per install request.`,
            );
          }
        }
        await mkdir(dirname(path), { recursive: true });
        await Bun.write(path, next);
        manifest = addInstalledAgent(manifest, {
          name: bundleName,
          platform: r.target,
          path,
          contentHash: newHash,
          installedAt: new Date().toISOString(),
          kind: "main",
        });
        manifest = await writeSidecars(r, paths, bundleName, manifest);
        installed.push({ target: r.target, path, agent: bundleName });
        continue;
      }

      // Path 2: manifest entry exists at a DIFFERENT path
      if (entry !== undefined && entry.path !== path) {
        if (!opts.force) {
          throw new SmithError({
            code: "already-exists",
            what: `${r.target} agent file (manifest path mismatch)`,
            identifier: path,
            suggestedCommand: `smith agent install ${bundleName} --force`,
          });
        }
        // --force: fall through to write at the new path. The old file at
        // entry.path is NOT cleaned up here — that's an uninstall
        // responsibility. The stale main-entry is dropped from the manifest
        // so the (name, platform) main-entry lookup remains unambiguous;
        // any sidecar entries the old install recorded are preserved
        // (they're path-keyed, so a later sidecar emission at the same
        // relative paths overwrites them in place via addInstalledAgent).
        manifest = {
          ...manifest,
          installed: manifest.installed.filter(
            (e) =>
              !(
                e.name === bundleName &&
                e.platform === r.target &&
                e.path === entry.path &&
                (e.kind === "main" || e.kind === undefined)
              ),
          ),
        };
      }

      // Path 3: no manifest entry, no on-disk file → fresh install
      if (onDisk === undefined) {
        await mkdir(dirname(path), { recursive: true });
        await Bun.write(path, next);
        manifest = addInstalledAgent(manifest, {
          name: bundleName,
          platform: r.target,
          path,
          contentHash: newHash,
          installedAt: new Date().toISOString(),
          kind: "main",
        });
        manifest = await writeSidecars(r, paths, bundleName, manifest);
        installed.push({ target: r.target, path, agent: bundleName });
        continue;
      }

      // Path 4: no manifest entry but file exists. Lazy-claim or refuse.
      const currentHash = hashContent(onDisk);
      if (currentHash === newHash) {
        // Byte-identical to what smith would render → silently claim.
        // Reported as "skipped" because no write happened.
        manifest = addInstalledAgent(manifest, {
          name: bundleName,
          platform: r.target,
          path,
          contentHash: currentHash,
          installedAt: new Date().toISOString(),
          kind: "main",
        });
        manifest = await writeSidecars(r, paths, bundleName, manifest);
        skipped.push({ target: r.target, path, agent: bundleName });
        continue;
      }

      if (!opts.force) {
        throw new SmithError({
          code: "already-exists",
          what: `${r.target} agent file at ${path} (not managed by smith)`,
          identifier: path,
          suggestedCommand: `smith agent install ${bundleName} --force`,
        });
      }

      // --force: overwrite and claim
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, next);
      manifest = addInstalledAgent(manifest, {
        name: bundleName,
        platform: r.target,
        path,
        contentHash: newHash,
        installedAt: new Date().toISOString(),
        kind: "main",
      });
      manifest = await writeSidecars(r, paths, bundleName, manifest);
      installed.push({ target: r.target, path, agent: bundleName });
    }

    await saveManifest(manifest, opts.homeDir);
  });

  return { installed, skipped, warnings };
}

async function saveManifest(
  manifest: InstalledAgentsFile,
  homeDir: string | undefined,
): Promise<void> {
  await saveInstalledAgents(
    manifest,
    homeDir ? { homeDir } : undefined,
  );
}

/**
 * Write each sidecar declared on a render to disk and record one manifest
 * entry per sidecar (kind: "sidecar"). Idempotent: a sidecar whose on-disk
 * bytes already match its rendered content skips the write but still
 * refreshes its manifest entry's timestamp/hash, which is harmless.
 *
 * Containment: each sidecar's relativePath is asserted to live under the
 * target's install root (mirrors the main-file write).
 *
 * Atomicity: each sidecar is written via `atomicWriteText` so a crash
 * mid-write can't leave half-written bytes at the destination — same
 * guarantee the manifest itself enjoys via `atomicWriteJson`.
 *
 * Returns the updated manifest copy; callers must re-bind their local
 * `manifest` variable.
 */
async function writeSidecars(
  r: RenderedAgent,
  paths: InstallPaths,
  bundleName: string,
  manifest: InstalledAgentsFile,
): Promise<InstalledAgentsFile> {
  const sidecars = r.sidecars ?? [];
  if (sidecars.length === 0) return manifest;
  let next = manifest;
  for (const sidecar of sidecars) {
    const sidecarPath = join(paths[r.target], sidecar.relativePath);
    await assertWithin(sidecarPath, paths[r.target]);
    await mkdir(dirname(sidecarPath), { recursive: true });
    await atomicWriteText(sidecarPath, sidecar.content);
    next = addInstalledAgent(next, {
      name: bundleName,
      platform: r.target,
      path: sidecarPath,
      contentHash: hashContent(sidecar.content),
      installedAt: new Date().toISOString(),
      kind: "sidecar",
    });
  }
  return next;
}
