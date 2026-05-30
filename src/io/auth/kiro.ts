import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../platform-detect";
import type { PlatformAuth } from "./types";

export interface DetectKiroAuthDeps {
  whichKiro?: () => Promise<string | undefined>;
  /** Read `~/.aws/sso/cache/kiro-auth-token-cli.json`. Defaults to fs.readFile. */
  readTokenCache?: (path: string) => Promise<string>;
  homeDir?: string;
  /** Override `Date.now()` for deterministic expiry testing. */
  now?: () => Date;
}

/**
 * Detect Kiro's auth state.
 *
 * Kiro's CLI (`kiro-cli`, sometimes also installed as `kiro`) authenticates
 * via AWS IAM Identity Center. The SSO cache at
 * `~/.aws/sso/cache/kiro-auth-token-cli.json` is the canonical signal:
 *   - `accessToken` non-empty → some credential is on file.
 *   - `expiresAt` (ISO timestamp, optional) — if present and in the past,
 *     the token is stale and we report unauthenticated. Without
 *     `expiresAt`, we accept the credential at face value.
 *
 * Kiro's "model" concept differs from the others — it exposes named agents
 * managed by AIM, not provider-prefixed model literals — so we don't
 * surface availableModels here. Tier resolution for Kiro is handled by
 * the model-resolution layer.
 */
export async function detectKiroAuth(
  deps: DetectKiroAuthDeps = {},
): Promise<PlatformAuth> {
  const home = deps.homeDir ?? homedir();
  const cachePath = join(home, ".aws", "sso", "cache", "kiro-auth-token-cli.json");
  const whichFn =
    deps.whichKiro ??
    (async () => {
      // Either binary counts as Kiro being installed; prefer kiro-cli (the
      // headless CLI) over the IDE binary. Matches PLATFORM_BINARIES.
      const cli = await findOnPath("kiro-cli");
      if (cli !== null) return cli;
      const ide = await findOnPath("kiro");
      return ide ?? undefined;
    });
  const readCache = deps.readTokenCache ?? ((p: string) => readFile(p, "utf-8"));
  const now = deps.now ?? (() => new Date());

  const cliPath = await whichFn();
  if (cliPath === undefined) {
    return {
      platform: "kiro",
      cliInstalled: false,
      status: "cli-not-installed",
      detail: "kiro-cli not on $PATH",
    };
  }

  let accessToken = "";
  let expiresAt: string | undefined;
  let authMethod: string | undefined;
  try {
    const raw = await readCache(cachePath);
    const parsed = JSON.parse(raw) as {
      accessToken?: unknown;
      expiresAt?: unknown;
      authMethod?: unknown;
    };
    if (typeof parsed.accessToken === "string") accessToken = parsed.accessToken;
    if (typeof parsed.expiresAt === "string") expiresAt = parsed.expiresAt;
    if (typeof parsed.authMethod === "string") authMethod = parsed.authMethod;
  } catch {
    // missing or unparseable
  }

  if (accessToken.length === 0) {
    return {
      platform: "kiro",
      cliInstalled: true,
      status: "unauthenticated",
      detail: "no credentials — run `kiro-cli login`",
    };
  }

  if (expiresAt !== undefined) {
    const exp = Date.parse(expiresAt);
    if (Number.isFinite(exp) && exp <= now().getTime()) {
      return {
        platform: "kiro",
        cliInstalled: true,
        status: "unauthenticated",
        detail: `credential expired at ${expiresAt} — run \`kiro-cli login\``,
      };
    }
  }

  const method = authMethod ? ` (${authMethod})` : "";
  return {
    platform: "kiro",
    cliInstalled: true,
    status: "authenticated",
    detail: `logged in${method}`,
  };
}
