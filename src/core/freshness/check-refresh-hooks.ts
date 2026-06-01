/**
 * Doctor's read-only knowledge-refresh detection.
 *
 * For each agent that has a persisted refresh-manifest.json under
 * `<agentSmithHome>/refresh/<agent>/`, this module verifies that the
 * on-disk hook config for each consented platform actually agrees with
 * what the manifest claims:
 *
 *   - missing-hook:        manifest consents to platform X, the agent IS
 *                          installed for platform X, but the platform's
 *                          hook config does not reference this agent.
 *   - orphaned-consent:    manifest consents to platform X, but the agent
 *                          is NOT installed for platform X at all.
 *   - corrupt-cache:       a per-source `<sourceId>.meta.json` exists but
 *                          fails JSON.parse or RefreshCacheEntrySchema —
 *                          inspected at the raw-file level because
 *                          `readRefreshCache` silently coerces these to
 *                          `undefined` for the runner's hot path.
 *
 * One additional global check (not per-agent):
 *
 *   - unmanaged-codex-hooks: `<codexHome>/hooks.json` exists, lacks the
 *                            `_smith_managed` sentinel, AND contains a
 *                            `SessionStart` hook entry — i.e. a hand-
 *                            written file that needs migration before
 *                            smith can manage it.
 *
 * This module performs detection only — repair is out of scope (Task 6).
 * It also never throws on filesystem absence: every read is wrapped in a
 * `.catch` that treats ENOENT-shaped failures as "no consent / no hook /
 * no cache" — the same semantics as the underlying io modules.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { readRefreshManifest } from "../knowledge/refresh-manifest";
import { RefreshCacheEntrySchema } from "../knowledge/refresh-cache";
import type { PlatformId } from "../../io/platform-detect";

export type RefreshPlatformId = "claude-code" | "codex" | "opencode" | "kiro";

export type Finding =
  | { kind: "missing-hook"; agent: string; platform: RefreshPlatformId }
  | { kind: "orphaned-consent"; agent: string; platform: RefreshPlatformId }
  | { kind: "corrupt-cache"; agent: string; sourceId: string }
  | { kind: "unmanaged-codex-hooks"; path: string };

export interface RefreshHooksReport {
  status: "ok" | "warn" | "error";
  findings: Finding[];
}

export interface CheckRefreshHooksInput {
  /** Root containing `refresh/<agent>/refresh-manifest.json`. */
  agentSmithHome: string;
  /** Root containing `agents/<agent>/sources/<sourceId>.meta.json`. */
  cacheRoot?: string;
  /** Per-platform agent install directories (mirrors {@link InstallPaths}). */
  installPaths: Record<RefreshPlatformId, string>;
  /** Absolute path to `<codexHome>/hooks.json`. */
  codexHooksPath: string;
  /** Root containing `plugins/agent-smith-refresh/.smith-managed`. */
  opencodeConfigHome: string;
}

// Kiro support: Task 2.5 adds the kiro-hooks module. Until then,
// REFRESH_PLATFORMS stays at the original three so the iteration here
// doesn't try to inspect kiro state that doesn't exist yet.
const REFRESH_PLATFORMS: readonly RefreshPlatformId[] = [
  "claude-code",
  "codex",
  "opencode",
];

export async function checkRefreshHooks(
  input: CheckRefreshHooksInput,
): Promise<RefreshHooksReport> {
  const findings: Finding[] = [];

  // Enumerate consented agents from the refresh-manifest tree. Missing dir
  // = no agents consented yet (a normal state on a fresh checkout).
  // (Pre-fix this read from `<home>/agents/` which conflated bundle state
  // with refresh consent — see refresh-manifest.ts header.)
  const refreshDir = join(input.agentSmithHome, "refresh");
  const agentNames = await listSubdirs(refreshDir);

  for (const agent of agentNames) {
    const manifest = await readRefreshManifest(input.agentSmithHome, agent).catch(
      () => undefined,
    );
    if (!manifest) continue;

    for (const platform of manifest.refresh_consent.platforms) {
      // Defensive narrowing: the manifest schema admits any PlatformId but
      // we only act on the three the refresh subsystem covers.
      if (!isRefreshPlatform(platform)) continue;
      const installed = await isAgentInstalled(agent, platform, input.installPaths);
      if (!installed) {
        findings.push({ kind: "orphaned-consent", agent, platform });
        continue;
      }
      const hookPresent = await isHookRegistered(
        agent,
        platform,
        input.installPaths,
        input.codexHooksPath,
        input.opencodeConfigHome,
      );
      if (!hookPresent) {
        findings.push({ kind: "missing-hook", agent, platform });
      }
    }

    // Per-agent cache scan. Skip silently when no cacheRoot is configured
    // or when this agent has no source dir.
    if (input.cacheRoot !== undefined) {
      const sourceDir = join(input.cacheRoot, "agents", agent, "sources");
      const corrupt = await findCorruptCacheEntries(sourceDir);
      for (const sourceId of corrupt) {
        findings.push({ kind: "corrupt-cache", agent, sourceId });
      }
    }
  }

  // Global: unmanaged codex hooks.json with a SessionStart hand-written
  // by the user. We DO NOT flag a missing file; only a file we'd refuse
  // to overwrite.
  const unmanaged = await detectUnmanagedCodexHooks(input.codexHooksPath);
  if (unmanaged) findings.push(unmanaged);

  return { status: findings.length === 0 ? "ok" : "warn", findings };
}

// ---------------------------------------------------------------------------
// Helpers — each treats absence as "no" and never throws on missing fs.
// ---------------------------------------------------------------------------

function isRefreshPlatform(p: PlatformId): p is RefreshPlatformId {
  return p === "claude-code" || p === "codex" || p === "opencode";
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** True if a rendered agent file exists for (agent, platform). Matches the
 *  layout used by `src/io/installer.ts`. */
async function isAgentInstalled(
  agent: string,
  platform: RefreshPlatformId,
  installPaths: CheckRefreshHooksInput["installPaths"],
): Promise<boolean> {
  if (platform === "codex") {
    // codex layout: <root>/<agent>/SKILL.md
    return Bun.file(join(installPaths.codex, agent, "SKILL.md")).exists();
  }
  // claude-code & opencode share <root>/<agent>.md
  return Bun.file(join(installPaths[platform], `${agent}.md`)).exists();
}

/** True if the platform's hook config currently references `agent`. */
async function isHookRegistered(
  agent: string,
  platform: RefreshPlatformId,
  installPaths: CheckRefreshHooksInput["installPaths"],
  codexHooksPath: string,
  opencodeConfigHome: string,
): Promise<boolean> {
  switch (platform) {
    case "claude-code":
      return claudeAgentHasHook(
        join(installPaths["claude-code"], `${agent}.md`),
        agent,
      );
    case "codex":
      return codexHooksManagedFor(codexHooksPath, agent);
    case "opencode":
      return opencodeSentinelManagedFor(opencodeConfigHome, agent);
    case "kiro":
      // Kiro hook detection lands in Task 2.5 (kiro-hooks.ts). Until then,
      // REFRESH_PLATFORMS does NOT include "kiro" so this branch is
      // effectively unreachable at runtime — but the type system needs an
      // exhaustive switch since RefreshPlatformId already includes it.
      return false;
  }
}

/** Parse the agent .md's YAML frontmatter and look for a SessionStart hook
 *  whose command invokes `smith knowledge refresh-session --agent <agent>`.
 *  Returns false for any failure (missing file, bad frontmatter, etc). */
async function claudeAgentHasHook(path: string, agent: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return false;
  }
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    return false;
  }
  const fm = parsed.data as Record<string, unknown> | undefined;
  if (!fm || typeof fm !== "object") return false;
  const hooks = (fm as { hooks?: unknown }).hooks;
  if (!hooks || typeof hooks !== "object") return false;
  const sessionStart = (hooks as { SessionStart?: unknown }).SessionStart;
  if (!Array.isArray(sessionStart)) return false;
  const needle = `--agent ${agent}`;
  for (const entry of sessionStart) {
    if (!entry || typeof entry !== "object") continue;
    const inner = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(inner)) continue;
    for (const h of inner) {
      if (!h || typeof h !== "object") continue;
      const cmd = (h as { command?: unknown }).command;
      if (typeof cmd === "string" && cmd.includes(needle)) return true;
    }
  }
  return false;
}

/** True if hooks.json is smith-managed AND lists `agent`. False otherwise. */
async function codexHooksManagedFor(path: string, agent: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const sentinel = (parsed as { _smith_managed?: unknown })._smith_managed;
  if (typeof sentinel !== "object" || sentinel === null) return false;
  const agents = (sentinel as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return false;
  return agents.includes(agent);
}

/** True when the opencode plugin sentinel lists `agent`. */
async function opencodeSentinelManagedFor(
  opencodeConfigHome: string,
  agent: string,
): Promise<boolean> {
  const sentinelPath = join(
    opencodeConfigHome,
    "plugins",
    "agent-smith-refresh",
    ".smith-managed",
  );
  let raw: string;
  try {
    raw = await readFile(sentinelPath, "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const agents = (parsed as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return false;
  return agents.includes(agent);
}

/** Return the source IDs whose `.meta.json` is unparseable or off-schema.
 *  A missing dir or no entries returns []. */
async function findCorruptCacheEntries(sourceDir: string): Promise<string[]> {
  const files = await listFiles(sourceDir);
  const corrupt: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".meta.json")) continue;
    const sourceId = file.slice(0, -".meta.json".length);
    const fullPath = join(sourceDir, file);
    let raw: string;
    try {
      raw = await readFile(fullPath, "utf8");
    } catch {
      // Race: file vanished between readdir and readFile. Treat as gone.
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      corrupt.push(sourceId);
      continue;
    }
    const ok = RefreshCacheEntrySchema.safeParse(parsed).success;
    if (!ok) corrupt.push(sourceId);
  }
  return corrupt;
}

/** Detect a hand-written codex hooks.json that contains a SessionStart
 *  hook but lacks the `_smith_managed` sentinel — i.e. a file smith would
 *  refuse to register into without user intervention. */
async function detectUnmanagedCodexHooks(
  path: string,
): Promise<Finding | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable user file — out of scope for THIS finding (the writer
    // raises its own SmithError; we don't double-report here).
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const sentinel = (parsed as { _smith_managed?: unknown })._smith_managed;
  if (sentinel !== undefined) return undefined; // smith-managed, not our concern.
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null) return undefined;
  const sessionStart = (hooks as { SessionStart?: unknown }).SessionStart;
  if (!Array.isArray(sessionStart) || sessionStart.length === 0) return undefined;
  return { kind: "unmanaged-codex-hooks", path };
}
