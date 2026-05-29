import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AtlassianEnvStatus, AtlassianEnvUpdate } from "gui-shared";
import { bridgeAtlassianAuthToPerProductEnv } from "../../../../src/io/atlassian-bridge";
import { parseEnvFile, upsertEnvLines } from "./dotenv-roundtrip";

// Re-export so existing callers (and the test suite) that import
// `upsertEnvLines` from this module keep working.
export { upsertEnvLines } from "./dotenv-roundtrip";

const SMITH_KEYS = {
  email: "SMITH_ATLASSIAN_EMAIL",
  token: "SMITH_ATLASSIAN_API_TOKEN",
  baseUrl: "SMITH_ATLASSIAN_BASE_URL",
} as const;

export interface AtlassianEnvDeps {
  /** Defaults to ~/.config/agent-smith/.env */
  smithEnvPath?: string;
  env?: NodeJS.ProcessEnv;
}

function paths(deps: AtlassianEnvDeps): {
  smithEnvPath: string;
  env: NodeJS.ProcessEnv;
} {
  return {
    smithEnvPath: deps.smithEnvPath ?? join(homedir(), ".config", "agent-smith", ".env"),
    env: deps.env ?? process.env,
  };
}

export async function readAtlassianEnv(deps: AtlassianEnvDeps = {}): Promise<AtlassianEnvStatus> {
  const { smithEnvPath, env } = paths(deps);

  // 1. process env (SMITH_*)
  if (env[SMITH_KEYS.email] && env[SMITH_KEYS.token]) {
    return {
      source: "env",
      email: env[SMITH_KEYS.email],
      hasToken: true,
      ...(env[SMITH_KEYS.baseUrl] && { baseUrl: env[SMITH_KEYS.baseUrl] }),
      editable: false,
    };
  }
  // 2. ~/.config/agent-smith/.env
  const smithFile = await tryParse(smithEnvPath);
  if (smithFile && smithFile[SMITH_KEYS.email] && smithFile[SMITH_KEYS.token]) {
    return {
      source: "smith-env-file",
      email: smithFile[SMITH_KEYS.email],
      hasToken: true,
      ...(smithFile[SMITH_KEYS.baseUrl] && { baseUrl: smithFile[SMITH_KEYS.baseUrl] }),
      editable: true,
    };
  }

  return { source: "none", hasToken: false, editable: true };
}

async function tryParse(path: string): Promise<Record<string, string> | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseEnvFile(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write the user-supplied email/token/baseUrl to the smith env file in a way
 * that preserves comments and unknown keys. Empty token = "do not change".
 */
export async function writeAtlassianEnv(
  update: AtlassianEnvUpdate,
  deps: AtlassianEnvDeps = {},
): Promise<void> {
  const { smithEnvPath } = paths(deps);
  const existing = await readFileOrEmpty(smithEnvPath);
  const smithUpdates: Record<string, string> = {
    [SMITH_KEYS.email]: update.email,
    ...(update.apiToken ? { [SMITH_KEYS.token]: update.apiToken } : {}),
    ...(update.baseUrl ? { [SMITH_KEYS.baseUrl]: update.baseUrl } : {}),
  };
  // Also bridge to per-product vars when baseUrl is available.
  let bridgeUpdates: Record<string, string> = {};
  if (update.baseUrl && update.apiToken) {
    bridgeUpdates = bridgeAtlassianAuthToPerProductEnv({
      email: update.email,
      token: update.apiToken,
      baseUrl: update.baseUrl,
    }) as unknown as Record<string, string>;
  }
  const next = upsertEnvLines(existing, { ...smithUpdates, ...bridgeUpdates });
  await mkdir(dirname(smithEnvPath), { recursive: true });
  await writeFile(smithEnvPath, next, { mode: 0o600 });
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Update or insert KEY=VALUE pairs while preserving comments, blanks, and
 * unrelated keys. Existing keys are updated in place; new keys are appended.
 * Values are quoted with double quotes if they contain whitespace, '=', or '#'.
 *
 * @deprecated Implementation lives in `dotenv-roundtrip.ts` now; this
 * comment block documents the previous local definition. The function is
 * re-exported at the top of this file for backward compatibility.
 */
