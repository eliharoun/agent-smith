import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../platform-detect";
import type { PlatformAuth } from "./types";

export interface DetectCodexAuthDeps {
  whichCodex?: () => Promise<string | undefined>;
  /** Read `~/.codex/auth.json`. Defaults to fs.readFile. */
  readAuthFile?: (path: string) => Promise<string>;
  homeDir?: string;
  /**
   * Override `process.env`. Codex honors `OPENAI_API_KEY` directly when no
   * auth file is present; we reflect that in detection.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Detect Codex's auth state.
 *
 * Codex (the OpenAI `codex` CLI) authenticates via two mechanisms:
 *   1. `~/.codex/auth.json` containing either:
 *        - `OPENAI_API_KEY: "sk-..."` (API-key auth), or
 *        - `tokens: { access_token: "..." }` (ChatGPT-account auth via
 *          `codex login`).
 *   2. `OPENAI_API_KEY` set in the process environment.
 *
 * Either signal counts as authenticated. Codex resolves model identifiers
 * server-side (e.g. `gpt-5`, `gpt-5-codex`, custom prompts) once auth is
 * established, so we do not surface availableModels here — the
 * model-resolution layer maps tier → known Codex literal independently.
 */
export async function detectCodexAuth(
  deps: DetectCodexAuthDeps = {},
): Promise<PlatformAuth> {
  const home = deps.homeDir ?? homedir();
  const authPath = join(home, ".codex", "auth.json");
  const whichFn =
    deps.whichCodex ?? (async () => (await findOnPath("codex")) ?? undefined);
  const readAuthFile = deps.readAuthFile ?? ((p: string) => readFile(p, "utf-8"));
  const env = deps.env ?? process.env;

  const cliPath = await whichFn();
  if (cliPath === undefined) {
    return {
      platform: "codex",
      cliInstalled: false,
      status: "cli-not-installed",
      detail: "codex CLI not on $PATH",
    };
  }

  // Layer 1: auth.json
  try {
    const raw = await readAuthFile(authPath);
    const parsed = JSON.parse(raw) as {
      OPENAI_API_KEY?: unknown;
      tokens?: { access_token?: unknown };
    };
    if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0) {
      return {
        platform: "codex",
        cliInstalled: true,
        status: "authenticated",
        detail: "OPENAI_API_KEY in ~/.codex/auth.json",
      };
    }
    if (
      typeof parsed.tokens?.access_token === "string" &&
      parsed.tokens.access_token.length > 0
    ) {
      return {
        platform: "codex",
        cliInstalled: true,
        status: "authenticated",
        detail: "ChatGPT account (via `codex login`)",
      };
    }
  } catch {
    // missing or unparseable
  }

  // Layer 2: process env OPENAI_API_KEY
  const envKey = env.OPENAI_API_KEY;
  if (typeof envKey === "string" && envKey.length > 0) {
    return {
      platform: "codex",
      cliInstalled: true,
      status: "authenticated",
      detail: "OPENAI_API_KEY in env",
    };
  }

  return {
    platform: "codex",
    cliInstalled: true,
    status: "unauthenticated",
    detail: "no credentials — run `codex login` or set OPENAI_API_KEY",
  };
}
