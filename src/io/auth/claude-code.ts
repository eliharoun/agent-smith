import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../platform-detect";
import type { PlatformAuth } from "./types";

/**
 * Subset of `claude auth status --json` we care about. Real output also
 * includes `apiProvider` (e.g. "bedrock", "anthropic") which we surface in
 * the doctor `detail` field but don't act on for resolution.
 */
export interface ClaudeAuthStatusOutput {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
}

export interface DetectClaudeCodeAuthDeps {
  whichClaude?: () => Promise<string | undefined>;
  /** Read `~/.claude/settings.json`. Defaults to fs.readFile. */
  readSettings?: (path: string) => Promise<string>;
  /**
   * Run `claude auth status --json` and parse the result. Returns
   * `undefined` when the command can't be executed or its output can't be
   * parsed. Defaults to spawning the resolved CLI path with a 5s timeout.
   */
  runAuthStatus?: (cliPath: string) => Promise<ClaudeAuthStatusOutput | undefined>;
  homeDir?: string;
}

/**
 * Detect Claude Code's auth state.
 *
 * Layered detection (each layer is sufficient if it succeeds):
 *   1. CLI on PATH? If not → `cli-not-installed`.
 *   2. Read `~/.claude/settings.json`. If `availableModels` is a non-empty
 *      array, the user is authenticated and we know exactly which models
 *      they can invoke.
 *   3. Spawn `claude auth status --json`. `loggedIn: true` is sufficient
 *      to mark authenticated even if the model list is unknown — Claude
 *      Code resolves tier names natively at runtime.
 *   4. Otherwise → `unauthenticated`.
 *
 * Unparseable settings.json is treated as missing (not unknown) — corrupt
 * credentials are functionally absent. CLI errors during auth-status fall
 * through silently to keep the doctor non-blocking; the user just won't get
 * the richer detail.
 */
export async function detectClaudeCodeAuth(
  deps: DetectClaudeCodeAuthDeps = {},
): Promise<PlatformAuth> {
  const home = deps.homeDir ?? homedir();
  const settingsPath = join(home, ".claude", "settings.json");
  const whichFn =
    deps.whichClaude ?? (async () => (await findOnPath("claude")) ?? undefined);
  const readSettings = deps.readSettings ?? ((p: string) => readFile(p, "utf-8"));
  const runAuthStatus = deps.runAuthStatus ?? defaultRunAuthStatus;

  const cliPath = await whichFn();
  if (cliPath === undefined) {
    return {
      platform: "claude-code",
      cliInstalled: false,
      status: "cli-not-installed",
      detail: "claude CLI not on $PATH",
    };
  }

  // Layer 1: settings.json availableModels
  let availableModels: string[] | undefined;
  try {
    const raw = await readSettings(settingsPath);
    const parsed = JSON.parse(raw) as { availableModels?: unknown };
    if (Array.isArray(parsed.availableModels) && parsed.availableModels.length > 0) {
      availableModels = parsed.availableModels.filter(
        (x): x is string => typeof x === "string",
      );
    }
  } catch {
    // missing, unparseable, or empty — fall through
  }

  if (availableModels && availableModels.length > 0) {
    return {
      platform: "claude-code",
      cliInstalled: true,
      status: "authenticated",
      availableModels,
      detail: `available models: ${availableModels.join(", ")}`,
    };
  }

  // Layer 2: claude auth status --json
  const status = await runAuthStatus(cliPath);
  if (status?.loggedIn === true) {
    const provider = status.apiProvider ? ` via ${status.apiProvider}` : "";
    return {
      platform: "claude-code",
      cliInstalled: true,
      status: "authenticated",
      detail: `logged in${provider}`,
    };
  }

  return {
    platform: "claude-code",
    cliInstalled: true,
    status: "unauthenticated",
    detail: "no credentials — run `claude auth login`",
  };
}

async function defaultRunAuthStatus(
  cliPath: string,
): Promise<ClaudeAuthStatusOutput | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, ["auth", "status", "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(undefined);
    }, 5_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as ClaudeAuthStatusOutput);
      } catch {
        resolve(undefined);
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}
