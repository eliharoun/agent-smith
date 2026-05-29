// src/io/opencode-plugin.ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SmithError } from "../core/smith-error";
import { renderOpencodePlugin } from "./opencode-plugin-template";

const PLUGIN_REL = "plugins/agent-smith-refresh";
const PLUGIN_ENTRY_STRING = `./${PLUGIN_REL}`;
const SENTINEL_FILENAME = ".smith-managed";

export interface OpencodePluginSentinel {
  agents: string[];
  installed_at: string;
}

function pluginDir(opencodeHome: string): string {
  return join(opencodeHome, PLUGIN_REL);
}

function sentinelPath(opencodeHome: string): string {
  return join(pluginDir(opencodeHome), SENTINEL_FILENAME);
}

function configPath(opencodeHome: string): string {
  return join(opencodeHome, "opencode.json");
}

export async function readOpencodePluginSentinel(
  opencodeHome: string,
): Promise<OpencodePluginSentinel | undefined> {
  let raw: string;
  try {
    raw = await readFile(sentinelPath(opencodeHome), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { agents?: unknown }).agents) ||
    !(parsed as { agents: unknown[] }).agents.every((a): a is string => typeof a === "string") ||
    typeof (parsed as { installed_at?: unknown }).installed_at !== "string"
  ) {
    throw new Error(
      `Malformed .smith-managed sentinel at ${sentinelPath(opencodeHome)}: expected { agents: string[], installed_at: string }`,
    );
  }
  return parsed as OpencodePluginSentinel;
}

async function writeSentinel(
  opencodeHome: string,
  sentinel: OpencodePluginSentinel,
): Promise<void> {
  await mkdir(pluginDir(opencodeHome), { recursive: true });
  await writeFile(sentinelPath(opencodeHome), `${JSON.stringify(sentinel, null, 2)}\n`, "utf8");
}

async function writePluginIfMissing(opencodeHome: string): Promise<void> {
  const path = join(pluginDir(opencodeHome), "index.ts");
  if (await Bun.file(path).exists()) return;
  await mkdir(pluginDir(opencodeHome), { recursive: true });
  await writeFile(path, renderOpencodePlugin(), "utf8");
}

// opencode.json is user-owned: it may be hand-edited or written by other
// tooling. If JSON.parse returns a non-object value (array, null, string,
// number, boolean) or fails outright, downstream ensurePluginEntry /
// removePluginEntry would silently corrupt the file (the array case loses
// the plugin entry on write-back because cfg.plugin = arr sets a
// non-numeric property on an array, which JSON.stringify drops), crash
// with a bare TypeError ("Cannot read properties of null", "Attempted to
// assign to readonly property"), or surface a raw SyntaxError with no
// path context. Validate the shape here so callers get a SmithError with
// the path and can locate the file to fix.
async function readConfig(opencodeHome: string): Promise<Record<string, unknown>> {
  const path = configPath(opencodeHome);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    throw new SmithError({
      code: "validation-failed",
      what: `opencode.json at ${path}`,
      reasons: [`malformed JSON: ${(parseErr as Error).message}`],
    });
  }
  const kind = describeJsonKind(parsed);
  if (kind !== "object") {
    throw new SmithError({
      code: "validation-failed",
      what: `opencode.json at ${path}`,
      reasons: [`expected a JSON object, got ${kind}`],
    });
  }
  return parsed as Record<string, unknown>;
}

function describeJsonKind(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // "object" | "string" | "number" | "boolean" | "undefined"
}

async function writeConfig(opencodeHome: string, cfg: Record<string, unknown>): Promise<void> {
  await mkdir(opencodeHome, { recursive: true });
  await writeFile(configPath(opencodeHome), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

function ensurePluginEntry(cfg: Record<string, unknown>): boolean {
  const arr: unknown[] = Array.isArray(cfg.plugin) ? (cfg.plugin as unknown[]) : [];
  if (arr.includes(PLUGIN_ENTRY_STRING)) return false;
  arr.push(PLUGIN_ENTRY_STRING);
  cfg.plugin = arr;
  return true;
}

function removePluginEntry(cfg: Record<string, unknown>): boolean {
  if (!Array.isArray(cfg.plugin)) return false;
  const before = cfg.plugin.length;
  const filtered = (cfg.plugin as unknown[]).filter((p) => p !== PLUGIN_ENTRY_STRING);
  cfg.plugin = filtered;
  return filtered.length !== before;
}

export async function registerAgentInOpencodePlugin(
  opencodeHome: string,
  agent: string,
): Promise<void> {
  await writePluginIfMissing(opencodeHome);

  const cfg = await readConfig(opencodeHome);
  if (ensurePluginEntry(cfg)) {
    await writeConfig(opencodeHome, cfg);
  }

  const existing = await readOpencodePluginSentinel(opencodeHome);
  const sentinel: OpencodePluginSentinel = existing ?? {
    agents: [],
    installed_at: new Date().toISOString(),
  };
  const isNewAgent = !sentinel.agents.includes(agent);
  if (isNewAgent) sentinel.agents.push(agent);
  if (isNewAgent || !existing) {
    await writeSentinel(opencodeHome, sentinel);
  }
}

export async function unregisterAgentFromOpencodePlugin(
  opencodeHome: string,
  agent: string,
): Promise<void> {
  const sentinel = await readOpencodePluginSentinel(opencodeHome);
  if (!sentinel) return;
  sentinel.agents = sentinel.agents.filter((a) => a !== agent);

  if (sentinel.agents.length === 0) {
    // Tear down: remove plugin dir + config entry.
    await rm(pluginDir(opencodeHome), { recursive: true, force: true });
    const cfg = await readConfig(opencodeHome);
    if (removePluginEntry(cfg)) {
      await writeConfig(opencodeHome, cfg);
    }
    return;
  }
  await writeSentinel(opencodeHome, sentinel);
}
