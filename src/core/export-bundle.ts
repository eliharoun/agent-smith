import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, posix as posixPath, resolve, isAbsolute } from "node:path";
import { sha256 } from "../io/hash";
import { pinnedIso } from "../io/manifest-time";
import picomatch from "picomatch";
import { writeArchive, type ArchiveEntry } from "../io/archive-tar";
import { manifestToReadme, type ExportManifest } from "./export-manifest";
import { SmithError } from "./smith-error";

export type UserMdPolicy = "stub" | "keep" | "reject";

export interface ExportBundleOptions {
  /** Absolute path to the source bundle directory. */
  bundlePath: string;
  /** Bundle name (matches agent.config.json:name). */
  bundleName: string;
  /** Embed required skills under skills/<name>/. */
  includeSkills: boolean;
  userMdPolicy: UserMdPolicy;
  /** Test seam: deterministic timestamp source. */
  now: () => Date;
  /** Caller-provided producer version (test seam; production reads package.json). */
  smithVersion: string;
  /** Test seam. Production callers omit and the implementation falls back
   *  to discoverSkills() over the user's registered skill catalogs. */
  resolveSkill?: (name: string) => Promise<string | null>;
  /** Compression mode for the output archive. Default "gzip". */
  compression?: "gzip" | "none";
  /** Output format. Default "archive". */
  format?: "archive" | "directory";
  /** Required when format === "directory": absolute parent dir to write into.
   *  Files land at <outputPath>/<bundleName>/. */
  outputPath?: string;
  /** Directory mode: include _smith-export.json. Default true. */
  includeManifest?: boolean;
  /** Directory mode: include the auto-generated README.md. Default false. */
  includeReadme?: boolean;
  /** Directory mode: replace <outputPath>/<bundleName>/ if it exists. Default false. */
  force?: boolean;
}

export interface ExportBundleResult {
  /** Output format actually used. */
  format: "archive" | "directory";
  /** Archive bytes (archive mode only). */
  archive?: Buffer;
  /** sha256 of `archive` (archive mode only). */
  archiveSha256?: string;
  /** sha256 over agent.config.json + IDENTITY/EXPERTISE/SOUL/USER stub. */
  contentHash: string;
  manifest: ExportManifest;
  /** Directory mode: absolute path of the bundle dir written. */
  outputPath?: string;
  /** Directory mode: relative paths (from `outputPath`) of every file written. */
  filesWritten?: string[];
}

const STUB_USER_MD = "# USER context\n\nThis file is a placeholder.\n";

interface KnowledgeSourceLike {
  id: string;
  type: string;
  path?: string;
  url?: string;
  baseUrl?: string;
  spaceKey?: string;
  jql?: string;
  remote?: string;
  server?: string;
}

function hostnameOf(s: string): string {
  try {
    return new URL(s).hostname;
  } catch {
    return s;
  }
}

function declareRemoteKnowledge(cfg: Record<string, unknown>): {
  remoteKnowledge: ExportManifest["requires"]["remoteKnowledge"];
  credentials: ExportManifest["requires"]["credentials"];
} {
  const k = cfg["knowledge"] as { sources?: KnowledgeSourceLike[] } | undefined;
  const sources = k?.sources ?? [];
  const remote: ExportManifest["requires"]["remoteKnowledge"] = [];
  let confluenceCount = 0;
  let jiraCount = 0;

  for (const s of sources) {
    if (s.type === "webpage" && typeof s.url === "string") {
      remote.push({ id: s.id, type: "webpage", endpoint: hostnameOf(s.url) });
    } else if (s.type === "web" && typeof s.url === "string") {
      remote.push({ id: s.id, type: "web", endpoint: hostnameOf(s.url) });
    } else if (s.type === "mcp") {
      remote.push({ id: s.id, type: "mcp", endpoint: s.server ?? "(MCP server must be available)" });
    } else if (s.type === "git" && typeof s.remote === "string") {
      remote.push({ id: s.id, type: "git", endpoint: hostnameOf(s.remote) });
    } else if (s.type === "confluence") {
      confluenceCount += 1;
      remote.push({ id: s.id, type: "confluence", endpoint: s.spaceKey ?? "" });
    } else if (s.type === "jira") {
      jiraCount += 1;
      remote.push({ id: s.id, type: "jira", endpoint: s.jql ?? "" });
    }
  }

  const credentials: ExportManifest["requires"]["credentials"] = [];
  if (confluenceCount + jiraCount > 0) {
    const parts: string[] = [];
    if (confluenceCount > 0) parts.push(`${confluenceCount} confluence source(s)`);
    if (jiraCount > 0) parts.push(`${jiraCount} jira source(s)`);
    credentials.push({
      kind: "atlassian",
      reason: parts.join(" and "),
      docPath: "15-sharing-and-distribution.md#7-credentials-when-sharing-knowledge-that-requires-auth",
    });
  }
  return { remoteKnowledge: remote, credentials };
}

interface RequireSkillEntry {
  name: string;
}

async function resolveSkillsForExport(
  cfg: Record<string, unknown>,
  resolveSkill: ExportBundleOptions["resolveSkill"],
): Promise<{ resolved: Array<{ name: string; path: string }>; missing: string[] }> {
  const reqs = ((cfg["requires"] as { skills?: RequireSkillEntry[] } | undefined)?.skills) ?? [];
  const resolved: Array<{ name: string; path: string }> = [];
  const missing: string[] = [];
  for (const r of reqs) {
    const path = resolveSkill ? await resolveSkill(r.name) : await defaultResolveSkill(r.name);
    if (path === null) missing.push(r.name);
    else resolved.push({ name: r.name, path });
  }
  return { resolved, missing };
}

async function defaultResolveSkill(name: string): Promise<string | null> {
  const { discoverSkills } = await import("../io/skill-discovery");
  const { loadSkillRegistry, canonicalSkillRegistryPath } = await import("../io/skill-registry");
  const reg = await loadSkillRegistry(canonicalSkillRegistryPath());
  for (const cat of reg.catalogs) {
    const summaries = await discoverSkills(cat);
    const hit = summaries.find((s) => s.name === name);
    if (hit) return hit.path;
  }
  return null;
}

async function packSkillEntries(
  bundleName: string,
  skills: Array<{ name: string; path: string }>,
): Promise<{ entries: ArchiveEntry[]; bundlesMeta: Array<{ name: string; bytes: number }> }> {
  const out: ArchiveEntry[] = [];
  const meta: Array<{ name: string; bytes: number }> = [];
  for (const s of skills) {
    let total = 0;
    await walkDir(s.path, async (filePath) => {
      const rel = posixPath.relative(s.path, filePath);
      const bytes = await readFile(filePath);
      total += bytes.length;
      out.push({
        path: posixJoin(bundleName, "skills", s.name, rel),
        bytes,
      });
    });
    meta.push({ name: s.name, bytes: total });
  }
  return { entries: out, bundlesMeta: meta };
}

function checkPortability(
  bundlePath: string,
  cfg: Record<string, unknown>,
): void {
  const k = cfg["knowledge"] as { sources?: KnowledgeSourceLike[] } | undefined;
  const sources = k?.sources ?? [];
  for (const s of sources) {
    if (s.type !== "file" && s.type !== "dir" && s.type !== "glob") continue;
    if (typeof s.path !== "string") continue;
    if (isAbsolute(s.path)) {
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge source path",
        reasons: [
          `source ${s.id} uses absolute path; rewrite to a path relative to the bundle directory or change to type: url/git`,
        ],
      });
    }
    const resolved = resolve(bundlePath, s.path);
    const root = resolve(bundlePath);
    if (!resolved.startsWith(root + "/") && resolved !== root) {
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge source path",
        reasons: [
          `source ${s.id} path resolves outside the bundle directory; move the content under the bundle dir or use type: git/url`,
        ],
      });
    }
  }
}

export async function exportBundle(opts: ExportBundleOptions): Promise<ExportBundleResult> {
  const cfgRaw = await readFile(join(opts.bundlePath, "agent.config.json"), "utf8");
  const cfg = JSON.parse(cfgRaw) as Record<string, unknown>;
  if (cfg["name"] !== opts.bundleName) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent.config.json",
      reasons: [`bundle name ${cfg["name"]} does not match expected ${opts.bundleName}`],
    });
  }
  checkPortability(opts.bundlePath, cfg);

  const identity = await readFile(join(opts.bundlePath, "IDENTITY.md"), "utf8");
  const expertise = await readFile(join(opts.bundlePath, "EXPERTISE.md"), "utf8");
  const soul = await readFile(join(opts.bundlePath, "SOUL.md"), "utf8");
  const userMd = await resolveUserMd(opts.bundlePath, opts.userMdPolicy);

  // Persona files are always included; prevent knowledge collection from
  // re-packing them if a source declaration accidentally references one.
  // README.md and _smith-export.json are also reserved — the export adds
  // its own copies and a duplicate entry would collide.
  const personaFiles = new Set<string>([
    "agent.config.json",
    "IDENTITY.md",
    "EXPERTISE.md",
    "SOUL.md",
    "USER.md",
    "README.md",
    "_smith-export.json",
  ]);
  const knowledgeEntries = await collectLocalKnowledge(opts.bundlePath, opts.bundleName, cfg, personaFiles);
  const { remoteKnowledge, credentials } = declareRemoteKnowledge(cfg);

  const reqSkills = ((cfg["requires"] as { skills?: RequireSkillEntry[] } | undefined)?.skills) ?? [];
  let skillEntries: ArchiveEntry[] = [];
  let skillMeta: Array<{ name: string; bytes: number }> = [];
  if (opts.includeSkills && reqSkills.length > 0) {
    const { resolved, missing } = await resolveSkillsForExport(cfg, opts.resolveSkill);
    if (missing.length > 0) {
      throw new SmithError({
        code: "validation-failed",
        what: "required skill",
        reasons: missing.map((n) => `skill not found in any registered catalog: ${n}`),
      });
    }
    const packed = await packSkillEntries(opts.bundleName, resolved);
    skillEntries = packed.entries;
    skillMeta = packed.bundlesMeta;
  }

  const bundleEntries: ArchiveEntry[] = [
    { path: posixJoin(opts.bundleName, "agent.config.json"), bytes: Buffer.from(cfgRaw, "utf8") },
    { path: posixJoin(opts.bundleName, "IDENTITY.md"), bytes: Buffer.from(identity, "utf8") },
    { path: posixJoin(opts.bundleName, "EXPERTISE.md"), bytes: Buffer.from(expertise, "utf8") },
    { path: posixJoin(opts.bundleName, "SOUL.md"), bytes: Buffer.from(soul, "utf8") },
    { path: posixJoin(opts.bundleName, "USER.md"), bytes: Buffer.from(userMd, "utf8") },
    ...knowledgeEntries,
    ...skillEntries,
  ];

  const contentHash = sha256Concat([cfgRaw, identity, expertise, soul, userMd]);

  // Build a manifest skeleton. We'll fill in `contents.files` after we know
  // every entry that ships in the archive.
  const manifest: ExportManifest = {
    exportSchemaVersion: 1,
    bundle: { name: opts.bundleName, contentHash },
    producedBy: {
      smithVersion: opts.smithVersion,
      exportedAt: pinnedIso(opts.now()),
      sourceSha: null,
      userAgent: `smith-cli/${opts.smithVersion}`,
    },
    requires: {
      minSmithVersion: "1.7.0",
      mcpServers: {
        required: ((cfg["mcp"] as { required?: string[] } | undefined)?.required) ?? [],
        peer: ((cfg["mcp"] as { peer?: string[] } | undefined)?.peer) ?? [],
        perAgent: (cfg["mcpServers"] as string[] | undefined) ?? [],
      },
      credentials,
      skills: reqSkills.map((r) => ({ name: r.name, embedded: opts.includeSkills })),
      remoteKnowledge,
    },
    contents: {
      files: [],
      knowledgeSnapshots: [],
      skillBundles: skillMeta,
    },
    omitted: { skills: opts.includeSkills ? [] : reqSkills.map((r) => r.name) },
  };

  // README and manifest are added last to the archive. The manifest's own
  // sha256 cannot be self-referenced, so its entry in contents.files[] uses
  // an all-zero placeholder. The recipient skips that entry when verifying.
  const readmeBytes = Buffer.from(manifestToReadme(manifest), "utf8");
  const readmeEntry: ArchiveEntry = {
    path: posixJoin(opts.bundleName, "README.md"),
    bytes: readmeBytes,
  };

  const filesForManifest: { path: string; sha256: string; size: number }[] = [
    ...bundleEntries.map((e) => ({ path: e.path, sha256: sha256(e.bytes), size: e.bytes.length })),
    { path: readmeEntry.path, sha256: sha256(readmeEntry.bytes), size: readmeEntry.bytes.length },
    {
      path: posixJoin(opts.bundleName, "_smith-export.json"),
      // The manifest cannot reference its own hash or exact byte length.
      // Recipients skip this entry during verification via the all-zero sentinel.
      sha256: "0".repeat(64),
      size: 0,
    },
  ];
  // Sort by path so the manifest is byte-identical regardless of filesystem
  // readdir order (which varies across OS and mount types).
  manifest.contents.files = filesForManifest.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  const finalManifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

  const format = opts.format ?? "archive";

  if (format === "directory") {
    if (!opts.outputPath) {
      throw new SmithError({
        code: "validation-failed",
        what: "output path",
        reasons: ["format: directory requires an outputPath"],
      });
    }
    return await writeBundleDirectory({
      bundleEntries,
      readmeEntry,
      finalManifestBytes,
      contentHash,
      manifest,
      bundleName: opts.bundleName,
      outputPath: opts.outputPath,
      includeManifest: opts.includeManifest ?? true,
      includeReadme: opts.includeReadme ?? false,
      force: opts.force ?? false,
    });
  }

  // archive mode (existing behavior)
  const allEntries: ArchiveEntry[] = [
    ...bundleEntries,
    readmeEntry,
    {
      path: posixJoin(opts.bundleName, "_smith-export.json"),
      bytes: finalManifestBytes,
    },
  ];

  const archive = await writeArchive(allEntries, { gzip: opts.compression !== "none" });
  return {
    format: "archive",
    archive,
    archiveSha256: sha256(archive),
    contentHash,
    manifest,
  };
}

async function resolveUserMd(bundlePath: string, policy: UserMdPolicy): Promise<string> {
  const userMdPath = join(bundlePath, "USER.md");
  let st;
  try {
    st = await lstat(userMdPath);
  } catch {
    if (policy === "reject") {
      throw new SmithError({
        code: "validation-failed",
        what: "USER.md",
        reasons: ["USER.md is missing and --user-md=reject was specified"],
      });
    }
    return STUB_USER_MD;
  }
  if (st.isSymbolicLink()) {
    if (policy === "reject") {
      throw new SmithError({
        code: "validation-failed",
        what: "USER.md",
        reasons: ["USER.md is a symlink and --user-md=reject was specified"],
      });
    }
    return STUB_USER_MD;
  }
  const content = await readFile(userMdPath, "utf8");
  if (policy === "stub") return STUB_USER_MD;
  if (policy === "reject" && content !== STUB_USER_MD) {
    throw new SmithError({
      code: "validation-failed",
      what: "USER.md",
      reasons: ["USER.md is not the canonical stub and --user-md=reject was specified"],
    });
  }
  return content;
}

function sha256Concat(strs: string[]): string {
  const h = createHash("sha256");
  for (const s of strs) h.update(s, "utf8");
  return h.digest("hex");
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

async function collectLocalKnowledge(
  bundlePath: string,
  bundleName: string,
  cfg: Record<string, unknown>,
  initialSeen?: Set<string>,
): Promise<ArchiveEntry[]> {
  const k = cfg["knowledge"] as { sources?: KnowledgeSourceLike[] } | undefined;
  const sources = k?.sources ?? [];
  const out: ArchiveEntry[] = [];
  const seen = initialSeen ? new Set(initialSeen) : new Set<string>();
  for (const s of sources) {
    if (s.type === "file" && typeof s.path === "string") {
      const abs = resolve(bundlePath, s.path);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        throw new SmithError({
          code: "validation-failed",
          what: "knowledge source path",
          reasons: [`source ${s.id} resolves to a symlink at ${s.path}; symlinks are not packed`],
        });
      }
      const rel = posixPath.relative(bundlePath, abs);
      if (seen.has(rel)) continue;
      seen.add(rel);
      const bytes = await readFile(abs);
      out.push({ path: posixJoin(bundleName, rel), bytes });
    } else if (s.type === "dir" && typeof s.path === "string") {
      const abs = resolve(bundlePath, s.path);
      await walkDir(abs, async (filePath) => {
        const rel = posixPath.relative(bundlePath, filePath);
        if (seen.has(rel)) return;
        seen.add(rel);
        const bytes = await readFile(filePath);
        out.push({ path: posixJoin(bundleName, rel), bytes });
      });
    } else if (s.type === "glob" && typeof s.path === "string") {
      const matcher = picomatch(s.path);
      await walkDir(bundlePath, async (filePath) => {
        const rel = posixPath.relative(bundlePath, filePath);
        if (!matcher(rel)) return;
        if (seen.has(rel)) return;
        seen.add(rel);
        const bytes = await readFile(filePath);
        out.push({ path: posixJoin(bundleName, rel), bytes });
      });
    }
  }
  return out;
}

async function walkDir(dir: string, fn: (path: string) => Promise<void>): Promise<void> {
  // Refuse to walk a directory whose path is itself a symlink.
  try {
    const st = await lstat(dir);
    if (st.isSymbolicLink()) return;
  } catch {
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // Sort by name so walk order is stable regardless of filesystem readdir order.
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkDir(full, fn);
    else if (e.isFile()) await fn(full);
  }
}

function posixJoin(...parts: string[]): string {
  return posixPath.join(...parts);
}

interface WriteBundleDirectoryOptions {
  bundleEntries: ArchiveEntry[];
  readmeEntry: ArchiveEntry;
  finalManifestBytes: Buffer;
  contentHash: string;
  manifest: ExportManifest;
  bundleName: string;
  outputPath: string;
  includeManifest: boolean;
  includeReadme: boolean;
  force: boolean;
}

async function writeBundleDirectory(opts: WriteBundleDirectoryOptions): Promise<ExportBundleResult> {
  const { mkdir, rm, stat, writeFile } = await import("node:fs/promises");
  const { dirname, join: pathJoin, resolve: pathResolve, sep } = await import("node:path");

  // Resolve to absolute paths so the containment guard works for relative
  // outputPaths like "." and the prefix comparison is reliable.
  const parentAbs = pathResolve(opts.outputPath);
  const target = pathResolve(parentAbs, opts.bundleName);

  if (!target.startsWith(parentAbs + sep) && target !== parentAbs) {
    throw new SmithError({
      code: "validation-failed",
      what: "output path",
      reasons: [`bundle name resolves outside outputPath: ${opts.bundleName}`],
    });
  }

  // Collision check.
  let exists = false;
  try {
    await stat(target);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists && !opts.force) {
    throw new SmithError({
      code: "validation-failed",
      what: "output path",
      reasons: [`${target} already exists; pass force=true to overwrite`],
    });
  }
  if (exists && opts.force) {
    await rm(target, { recursive: true, force: true });
  }
  await mkdir(target, { recursive: true });

  // Build the file list. Same shape as archive mode, minus the conditional pieces.
  type FileToWrite = { rel: string; bytes: Buffer };
  const files: FileToWrite[] = [];

  // Persona files + local-knowledge entries: bundleEntries paths are like
  // "<bundleName>/IDENTITY.md"; strip the prefix to get the relative path.
  const prefix = `${opts.bundleName}/`;
  for (const e of opts.bundleEntries) {
    const rel = e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e.path;
    files.push({ rel, bytes: e.bytes });
  }

  // README is opt-in for directory mode (its content references "extract this
  // archive", which is wrong inside a git checkout).
  if (opts.includeReadme) {
    const rel = opts.readmeEntry.path.startsWith(prefix)
      ? opts.readmeEntry.path.slice(prefix.length)
      : opts.readmeEntry.path;
    files.push({ rel, bytes: opts.readmeEntry.bytes });
  }

  // Manifest is opt-out for directory mode (downstream `smith` commands may
  // read it; matches helm pull keeping Chart.yaml).
  if (opts.includeManifest) {
    files.push({ rel: "_smith-export.json", bytes: opts.finalManifestBytes });
  }

  // Sort by rel for deterministic iteration order.
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const filesWritten: string[] = [];
  for (const f of files) {
    const out = pathJoin(target, f.rel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, f.bytes);
    filesWritten.push(f.rel);
  }

  return {
    format: "directory",
    contentHash: opts.contentHash,
    manifest: opts.manifest,
    outputPath: target,
    filesWritten,
  };
}
