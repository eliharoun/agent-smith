/**
 * Doctor section that audits MCP server `command` fields across all four
 * platform configs (Claude Code / OpenCode / Codex / Kiro).
 *
 * Reports `fragile-spawn` findings: any `command` that isn't an absolute
 * path. The toggle bug from v2.1 wrote `"smith"` literally; GUI apps
 * launched from Spotlight/dock don't inherit shell PATH, so a bare-name
 * spawn silently fails. Bare names whose `which` lookup happens to
 * resolve in the doctor's current shell env are still flagged — they
 * may not resolve in a Spotlight-launched context.
 *
 * Auto-fix rewrites the command to its absolute path. Resolution order:
 *   1) When `command === "smith"`, prefer `process.argv[1]` realpath
 *      since the doctor is being run by `smith doctor`.
 *   2) Otherwise, `which <command>`.
 * If neither resolves, `resolvedAbsolute` is null — the auto-fix path
 * skips those entries with a warning ("can't auto-fix; install <name>
 * first").
 *
 * The detection is read-only and never throws on filesystem absence or
 * malformed config files: missing/unparseable configs are treated as
 * "no servers to inspect".
 */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parse as parseToml } from "smol-toml";

export type McpSpawnPlatform = "opencode" | "claude-code" | "codex" | "kiro";

export interface McpSpawnFinding {
  platform: McpSpawnPlatform;
  configPath: string;
  serverName: string;
  /** The bare value as on disk. */
  command: string;
  /** Absolute path the auto-fix would substitute, or null when unresolvable. */
  resolvedAbsolute: string | null;
}

export interface McpSpawnSection {
  status: "clean" | "fragile-spawn";
  findings: McpSpawnFinding[];
}

export interface McpSpawnPaths {
  /** OpenCode global config (`~/.config/opencode/opencode.json`). */
  opencodeConfig: string;
  /** Claude Code global config (`~/.claude.json`). */
  claudeMcpConfig: string;
  /** Codex global config (`~/.codex/config.toml`). */
  codexConfig: string;
  /** Kiro global MCP config (`~/.kiro/settings/mcp.json`). */
  kiroMcpConfig: string;
}

export interface CheckMcpSpawnInput {
  paths: McpSpawnPaths;
  /** Test seam: synchronous `which`. Defaults to spawning the user's `which`. */
  which?: (command: string) => string | null;
  /** Test seam: realpath of the running smith binary. Defaults to `process.argv[1]` realpath. */
  resolveSmithPath?: () => string | null;
  /**
   * Optional gating set of platforms whose CLI was detected on PATH. When
   * provided, platforms NOT in the set are skipped entirely (no findings
   * emitted for their config). When omitted, all four platforms are
   * inspected (back-compat with existing callers and tests).
   */
  installedPlatforms?: Set<McpSpawnPlatform>;
}

/**
 * Walk every platform's MCP config and collect findings for non-absolute
 * `command` fields. Always returns — never throws on bad input.
 */
export async function checkMcpSpawnCommands(
  input: CheckMcpSpawnInput,
): Promise<McpSpawnSection> {
  const which = input.which ?? defaultWhich;
  const resolveSmithPath = input.resolveSmithPath ?? defaultResolveSmithPath;

  const findings: McpSpawnFinding[] = [];
  const ctx: ResolveCtx = { which, resolveSmithPath };

  // Stable iteration order across platforms — keeps the report deterministic
  // for human consumption and for snapshot-style assertions.
  const platforms: McpSpawnPlatform[] = ["claude-code", "codex", "kiro", "opencode"];
  for (const platform of platforms) {
    if (input.installedPlatforms && !input.installedPlatforms.has(platform)) continue;
    const path = configPathFor(platform, input.paths);
    const entries = await readPlatformEntries(platform, path);
    for (const entry of entries) {
      if (isAbsolute(entry.command)) continue;
      findings.push({
        platform,
        configPath: path,
        serverName: entry.name,
        command: entry.command,
        resolvedAbsolute: await resolveCommand(entry.command, ctx),
      });
    }
  }

  return {
    status: findings.length === 0 ? "clean" : "fragile-spawn",
    findings,
  };
}

// ---------------------------------------------------------------------------
// Per-platform readers — mirror the JSON / TOML access patterns from
// `src/io/mcp-availability.ts` but additionally extract the `command` field.
// We do NOT extend the availability module because callers there only ever
// need the set of server names; threading per-server `command` through
// would expand its surface for a single consumer. Duplicating the parser
// keeps both readers focused and keeps changes here from rippling into the
// availability hot path used at install time.
// ---------------------------------------------------------------------------

interface ServerEntry {
  name: string;
  command: string;
}

function configPathFor(platform: McpSpawnPlatform, paths: McpSpawnPaths): string {
  switch (platform) {
    case "opencode":
      return paths.opencodeConfig;
    case "claude-code":
      return paths.claudeMcpConfig;
    case "codex":
      return paths.codexConfig;
    case "kiro":
      return paths.kiroMcpConfig;
  }
}

async function readPlatformEntries(
  platform: McpSpawnPlatform,
  path: string,
): Promise<ServerEntry[]> {
  switch (platform) {
    case "opencode":
      return readJsonEntries(path, "mcp");
    case "claude-code":
      return readClaudeCodeEntries(path);
    case "codex":
      return readCodexTomlEntries(path);
    case "kiro":
      return readJsonEntries(path, "mcpServers");
  }
}

async function readJsonText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readJsonEntries(path: string, key: string): Promise<ServerEntry[]> {
  const text = await readJsonText(path);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  return entriesFromBlock(parsed[key]);
}

/**
 * Claude Code stores MCP servers in `~/.claude.json` at two locations:
 * `mcpServers` (user-scope) and `projects.<dir>.mcpServers` (local-scope).
 * Both are walked; project-scope entries are namespaced by project key in
 * iteration order (Claude itself doesn't disambiguate; we surface the entry
 * name as it appears in the file).
 */
async function readClaudeCodeEntries(path: string): Promise<ServerEntry[]> {
  const text = await readJsonText(path);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const out: ServerEntry[] = [];
  out.push(...entriesFromBlock(parsed.mcpServers));
  const projects = parsed.projects;
  if (isRecord(projects)) {
    for (const project of Object.values(projects)) {
      if (!isRecord(project)) continue;
      out.push(...entriesFromBlock(project.mcpServers));
    }
  }
  return out;
}

async function readCodexTomlEntries(path: string): Promise<ServerEntry[]> {
  const text = await readJsonText(path);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  return entriesFromBlock(parsed.mcp_servers);
}

function entriesFromBlock(block: unknown): ServerEntry[] {
  if (!isRecord(block)) return [];
  const out: ServerEntry[] = [];
  for (const [name, value] of Object.entries(block)) {
    if (!isRecord(value)) continue;
    const command = value.command;
    if (typeof command !== "string" || command.length === 0) continue;
    out.push({ name, command });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsolute(command: string): boolean {
  // POSIX absolute paths only — Windows isn't a supported platform for the
  // smith CLI today (see README install docs). If/when Windows lands, this
  // becomes node:path.isAbsolute.
  return command.startsWith("/");
}

// ---------------------------------------------------------------------------
// Resolution — `process.argv[1]` realpath for "smith", `which` for everything
// else. A null return means "can't auto-fix"; the caller skips the finding.
// ---------------------------------------------------------------------------

interface ResolveCtx {
  which: (command: string) => string | null;
  resolveSmithPath: () => string | null;
}

async function resolveCommand(command: string, ctx: ResolveCtx): Promise<string | null> {
  if (command === "smith") {
    const smithPath = ctx.resolveSmithPath();
    if (smithPath) return smithPath;
  }
  return ctx.which(command);
}

/**
 * Default `which` implementation. We invoke a real shell with `-l -c which`
 * so the lookup uses the user's full login PATH (including ~/.zshrc edits).
 * Output is the absolute resolved path, or null on any failure.
 */
function defaultWhich(command: string): string | null {
  // Reject obviously hostile inputs — `command` came from a config file the
  // user controls so this is defense-in-depth only. A bare name like "smith"
  // or "git" is a typical safe input.
  if (!/^[A-Za-z0-9._+\-/]+$/.test(command)) return null;
  try {
    const result = spawnSync("/bin/sh", ["-lc", `command -v ${command}`], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.status !== 0) return null;
    const out = result.stdout?.trim() ?? "";
    if (out.length === 0) return null;
    if (!out.startsWith("/")) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Default smith binary resolver. The synchronous shape lets the detector
 * call this once per finding without awaiting; production wiring in
 * `src/cli/commands/doctor.ts` precomputes the realpath at startup and
 * injects a closure that returns the cached value. Falling back to
 * `process.argv[1]` raw is best-effort — when no entry is recoverable
 * we return null and the auto-fix path skips the finding.
 */
function defaultResolveSmithPath(): string | null {
  const entry = process.argv[1];
  if (!entry || typeof entry !== "string" || entry.length === 0) return null;
  return entry;
}
