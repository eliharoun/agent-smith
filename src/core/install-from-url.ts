// src/core/install-from-url.ts
//
// C3.8 (v1-task): Shared core for `smith agent|skill install --from <url>`.
//
// Pipeline:
//   1. Derives target path from URL via deriveRemotePath(url, remoteRoot).
//   2. Collision check: if path exists with .git/, compare its origin URL.
//      Match (modulo .git suffix + case) → reuse path; mismatch → throw
//      an actionable error pointing at `catalog unregister --purge-clone`.
//   3. Clones (or fetches+resets) via cloneOrFetch.
//   4. Discovers bundles in the cloned tree by scanning for the
//      kind-specific manifest file:
//        - agent: any agent.config.json (name read from JSON)
//        - skill: any SKILL.md           (name = parent directory name)
//   5. Registers the catalog in registry.json (agent) or
//      skill-catalogs.json (skill) with a populated `remote` block.
//      Re-install of a catalog at the same rootPath updates the
//      remote block in place rather than appending.
//   6. Returns { cloneDir, bundles, remote } so the CLI verb (Tasks
//      9/10) can decide what to install next.
//
// Constraints:
//   - .git and node_modules subtrees are skipped during bundle scan to
//     avoid spurious matches.
//   - Order of bundles in the result is sorted for determinism.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cloneOrFetch } from "../io/git-clone";
import { sameGitRemote } from "../io/git-url";
import { canonicalRegistryPath, loadRegistry, saveRegistry } from "../io/registry";
import { deriveRemotePath } from "../io/remote-path";
import { defaultRemoteRoot } from "../io/remote-root";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../io/skill-registry";
import { SmithError } from "./smith-error";
import type { Remote } from "./types";

export interface InstallFromUrlOptions {
  kind: "agent" | "skill";
  url: string;
  /** Defaults to "HEAD" — clones the remote's default branch tip. */
  ref?: string;
  /** Override remote-clones root (test seam). Defaults to `<stateHome>/remote`. */
  remoteRoot?: string;
  /** Override the registry JSON path (test seam). When set, bypasses
   *  canonicalRegistryPath() / canonicalSkillRegistryPath() so CLI verbs
   *  that already accept a --home override can route the registry write
   *  through the same path their installer reads. */
  registryPath?: string;
}

export interface InstallFromUrlResult {
  cloneDir: string;
  bundles: string[];
  remote: Remote;
}

const DEFAULT_REF = "HEAD";

// C4.0.2: option-injection guard for refs passed into `git clone --branch`
// / `git fetch <ref>`. A ref starting with '-' would be parsed as a git
// flag (e.g. --upload-pack=evil); shell metacharacters would only matter
// if the ref is ever concatenated into a shell string, but we reject them
// defensively so a future regression can't quietly turn into RCE. Control
// chars are rejected for the same defense-in-depth reason. Mitigates
// security-audit finding HIGH-1.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
const FORBIDDEN_REF_CHARS = /[;|`$\n\r\u0000-\u001f\u007f]/;

export function validateRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new Error(`ref starts with '-' (option injection): ${ref}`);
  }
  if (FORBIDDEN_REF_CHARS.test(ref)) {
    throw new Error(`ref contains forbidden character: ${JSON.stringify(ref)}`);
  }
}

export async function installFromUrl(opts: InstallFromUrlOptions): Promise<InstallFromUrlResult> {
  const ref = opts.ref ?? DEFAULT_REF;
  validateRef(ref);
  const remoteRoot = opts.remoteRoot ?? defaultRemoteRoot();
  const targetDir = deriveRemotePath(opts.url, remoteRoot);

  // RC2-4: hard-error if any existing source OR skill catalog already
  // points to this URL (per sameGitRemote — accounts for .git suffix,
  // case, scheme variations). No escape hatch: users must explicitly
  // `unregister --purge-clone` the existing entry first. Rationale: two
  // catalogs pointing at the same upstream silently double-install
  // bundles and confuse sync semantics.
  //
  // Exception: a same-URL entry whose rootPath equals targetDir is the
  // SAME catalog being re-installed (idempotent self-update path). That
  // case is allowed and handled later by the update-in-place branch.
  await checkDuplicateUrl(opts.url, opts.kind, targetDir, opts.registryPath);

  await checkCollision(targetDir, opts.url);

  const cloneResult = await cloneOrFetch({
    url: opts.url,
    ref,
    targetDir,
  });

  const bundles = await discoverBundles(targetDir, opts.kind);

  const now = new Date().toISOString();
  const remote: Remote = {
    url: opts.url,
    ref,
    lastPulledSha: cloneResult.sha,
    lastPulledAt: now,
    lastRemoteSha: cloneResult.sha,
    lastCheckedAt: now,
  };

  if (opts.kind === "agent") {
    const registryPath = opts.registryPath ?? canonicalRegistryPath();
    const reg = await loadRegistry(registryPath);
    const existing = reg.sources.find((s) => s.rootPath === targetDir);
    if (existing) {
      existing.remote = remote;
      existing.gitRemote = opts.url;
    } else {
      reg.sources.push({
        kind: "registered",
        rootPath: targetDir,
        label: deriveLabel(opts.url),
        gitRemote: opts.url,
        remote,
      });
    }
    await saveRegistry(registryPath, reg);
  } else {
    const path = opts.registryPath ?? canonicalSkillRegistryPath();
    const reg = await loadSkillRegistry(path);
    const existing = reg.catalogs.find((c) => c.rootPath === targetDir);
    if (existing) {
      existing.remote = remote;
      existing.gitRemote = opts.url;
    } else {
      reg.catalogs.push({
        kind: "team-shared",
        rootPath: targetDir,
        label: deriveLabel(opts.url),
        gitRemote: opts.url,
        remote,
      });
    }
    await saveSkillRegistry(path, reg);
  }

  return { cloneDir: targetDir, bundles, remote };
}

async function checkDuplicateUrl(
  url: string,
  kind: "agent" | "skill",
  targetDir: string,
  registryPathOverride?: string,
): Promise<void> {
  // Scan BOTH registries — a duplicate across kinds is still a duplicate
  // for sync/refresh purposes. registryPathOverride applies only to the
  // kind being installed; the other registry uses its canonical path.
  const agentPath =
    kind === "agent" ? (registryPathOverride ?? canonicalRegistryPath()) : canonicalRegistryPath();
  const skillPath =
    kind === "skill"
      ? (registryPathOverride ?? canonicalSkillRegistryPath())
      : canonicalSkillRegistryPath();

  const [agentReg, skillReg] = await Promise.all([
    loadRegistry(agentPath),
    loadSkillRegistry(skillPath),
  ]);

  for (const s of agentReg.sources) {
    // Skip self: same URL at targetDir is the idempotent re-install path.
    if (s.rootPath === targetDir) continue;
    if (sameGitRemote(s.remote?.url, url) || sameGitRemote(s.gitRemote, url)) {
      throw new SmithError({
        code: "already-exists",
        what: "catalog by git remote",
        identifier: `${url} (registered as agent catalog "${s.label}" at ${s.rootPath}). Run 'smith agent catalog unregister ${s.label} --purge-clone' first if you want to reinstall.`,
      });
    }
  }
  for (const c of skillReg.catalogs) {
    if (c.rootPath === targetDir) continue;
    if (sameGitRemote(c.remote?.url, url) || sameGitRemote(c.gitRemote, url)) {
      throw new SmithError({
        code: "already-exists",
        what: "catalog by git remote",
        identifier: `${url} (registered as skill catalog "${c.label}" at ${c.rootPath}). Run 'smith skill catalog unregister ${c.label} --purge-clone' first if you want to reinstall.`,
      });
    }
  }
}

async function checkCollision(targetDir: string, url: string): Promise<void> {
  const gitConfigPath = join(targetDir, ".git", "config");
  let cfg: string;
  try {
    cfg = await readFile(gitConfigPath, "utf-8");
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
      return; // fresh path — no collision possible
    }
    throw e;
  }
  const match = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/);
  if (!match?.[1]) return; // no origin recorded yet
  const existingUrl = match[1];
  // Use the canonical equality helper. sameGitRemote handles all URL
  // shape variations (.git suffix, scheme, case in first 3 segments,
  // SSH `:` vs `/` separator) so the collision check matches what
  // duplicate-URL detection elsewhere in the install pipeline uses.
  if (!sameGitRemote(existingUrl, url)) {
    throw new Error(
      `${targetDir} exists with different origin (${existingUrl}). ` +
        `Use 'smith agent catalog unregister ${targetDir} --purge-clone' first.`,
    );
  }
}

async function discoverBundles(rootDir: string, kind: "agent" | "skill"): Promise<string[]> {
  const out: string[] = [];
  const target = kind === "agent" ? "agent.config.json" : "SKILL.md";
  await walk(rootDir, async (filePath) => {
    if (filePath.endsWith(`/${target}`)) {
      const dir = filePath.slice(0, -target.length - 1);
      const name = await readBundleName(filePath, kind, dir);
      if (name) out.push(name);
    }
  });
  return out.sort();
}

async function walk(dir: string, fn: (path: string) => Promise<void>): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, fn);
    } else if (e.isFile()) {
      await fn(full);
    }
  }
}

async function readBundleName(
  filePath: string,
  kind: "agent" | "skill",
  dir: string,
): Promise<string | null> {
  try {
    if (kind === "agent") {
      const raw = JSON.parse(await readFile(filePath, "utf-8"));
      return typeof raw.name === "string" ? raw.name : null;
    }
    // SKILL.md — bundle name = `name:` frontmatter field, matching the
    // canonical resolution used by src/io/skill-discovery.ts. Falls back
    // to the parent directory name when frontmatter is malformed so the
    // disambiguation hint still has something to print.
    const raw = await readFile(filePath, "utf-8");
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch?.[1]) {
      const nameMatch = fmMatch[1].match(/^name:\s*(\S+)\s*$/m);
      if (nameMatch?.[1]) return nameMatch[1];
    }
    return dir.split("/").pop() ?? null;
  } catch {
    return null;
  }
}

function deriveLabel(url: string): string {
  const stripped = url
    .replace(/\.git\/?$/, "")
    .replace(/^ssh:\/\/git@|^git@|^https?:\/\/|^file:\/\//, "")
    .replace(":", "/");
  const parts = stripped.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return stripped;
}
