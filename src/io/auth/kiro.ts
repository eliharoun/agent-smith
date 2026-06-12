import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../platform-detect";
import type { PlatformAuth } from "./types";

/**
 * Subset of `kiro-cli whoami --format json` we care about. The real output
 * also includes `startUrl`, `region`, and `email`; we only surface
 * `accountType` (e.g. "IamIdentityCenter", "BuilderId") in the doctor
 * `detail` field and don't act on it for resolution.
 */
export interface KiroWhoamiOutput {
  accountType?: string;
  email?: string;
}

export interface DetectKiroAuthDeps {
  whichKiro?: () => Promise<string | undefined>;
  /** Read `~/.aws/sso/cache/kiro-auth-token-cli.json`. Defaults to fs.readFile. */
  readTokenCache?: (path: string) => Promise<string>;
  /**
   * Run `kiro-cli whoami --format json` and return parsed output. Resolves
   * `undefined` when the command exits non-zero, errors, or times out;
   * resolves an object (possibly empty `{}`) when it exits 0. Defaults to
   * spawning the resolved CLI path with a 5s timeout. Success is keyed on the
   * exit code — the object is used only to enrich the doctor detail.
   */
  runWhoami?: (cliPath: string) => Promise<KiroWhoamiOutput | undefined>;
  homeDir?: string;
  /** Override `Date.now()` for deterministic expiry testing. */
  now?: () => Date;
}

/**
 * Detect Kiro's auth state.
 *
 * Kiro's CLI (`kiro-cli`, sometimes also installed as `kiro`) authenticates
 * via AWS IAM Identity Center or AWS Builder ID. The SSO cache at
 * `~/.aws/sso/cache/kiro-auth-token-cli.json` is the fast-path signal:
 *   - `accessToken` empty → unauthenticated.
 *   - `accessToken` present and `expiresAt` absent or in the future →
 *     authenticated (no subprocess needed).
 *   - `accessToken` present but `expiresAt` in the past → ambiguous. AWS SSO
 *     access tokens are short-lived (~hours) while the refresh token in the
 *     same file lasts far longer, and kiro-cli refreshes the access token
 *     lazily on use WITHOUT rewriting this cache file. So an expired on-disk
 *     access token does not mean the session is dead. When a `refreshToken`
 *     is present we ask kiro-cli itself — `kiro-cli whoami` exits 0 iff the
 *     session is live (it performs the refresh internally). This is the only
 *     authoritative signal, and it works identically for IAM Identity Center
 *     and Builder ID, so it is correct for any Kiro user.
 *
 * Kiro's "model" concept differs from the others — it exposes named agents
 * managed by AIM, not provider-prefixed model literals — so we don't
 * surface availableModels here. Tier resolution for Kiro is handled by
 * the model-resolution layer.
 */
export async function detectKiroAuth(deps: DetectKiroAuthDeps = {}): Promise<PlatformAuth> {
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
  const runWhoami = deps.runWhoami ?? defaultRunWhoami;
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
  let refreshToken = "";
  try {
    const raw = await readCache(cachePath);
    const parsed = JSON.parse(raw) as {
      accessToken?: unknown;
      expiresAt?: unknown;
      authMethod?: unknown;
      refreshToken?: unknown;
    };
    if (typeof parsed.accessToken === "string") accessToken = parsed.accessToken;
    if (typeof parsed.expiresAt === "string") expiresAt = parsed.expiresAt;
    if (typeof parsed.authMethod === "string") authMethod = parsed.authMethod;
    if (typeof parsed.refreshToken === "string") refreshToken = parsed.refreshToken;
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
      // Access token expired on disk. If a refresh token is present, the
      // session may still be live (kiro-cli refreshes lazily) — verify with
      // the CLI, which is the only authoritative check.
      if (refreshToken.length > 0) {
        const whoami = await runWhoami(cliPath);
        if (whoami !== undefined) {
          // Success is the exit code; `whoami` may be `{}` if the output
          // couldn't be parsed for detail. Prefer the CLI's accountType,
          // then the cache's authMethod, then a bare "logged in".
          const method = whoami.accountType ?? authMethod;
          return {
            platform: "kiro",
            cliInstalled: true,
            status: "authenticated",
            detail: method ? `logged in (${method})` : "logged in",
          };
        }
      }
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

async function defaultRunWhoami(cliPath: string): Promise<KiroWhoamiOutput | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, ["whoami", "--format", "json"], {
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
      // Exit code is the authoritative auth signal: 0 = session is live.
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      // Best-effort detail enrichment only. `kiro-cli whoami --format json`
      // prints a JSON object followed by trailing plaintext ("Profile:\n...")
      // on stdout, so we extract the first JSON object rather than parsing
      // the whole stream. A parse miss must NOT downgrade the auth result —
      // resolve `{}` so the caller still treats exit 0 as authenticated.
      const match = out.match(/\{[\s\S]*?\}/);
      if (match === null) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(match[0]) as KiroWhoamiOutput);
      } catch {
        resolve({});
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}
