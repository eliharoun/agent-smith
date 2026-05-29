import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOpenCodeModels } from "../opencode-models";
import { findOnPath } from "../platform-detect";
import type { PlatformAuth } from "./types";

export interface DetectOpenCodeAuthDeps {
  /**
   * Resolve the `opencode` binary on PATH. Returns the absolute path or
   * `undefined` if not installed. Defaults to `which("opencode")`.
   */
  whichOpenCode?: () => Promise<string | undefined>;
  /** Read the OpenCode auth file. Defaults to `fs.readFile` on the canonical path. */
  readAuthFile?: (path: string) => Promise<string>;
  /** Fetch the live models list. Defaults to {@link getOpenCodeModels}. */
  getModels?: () => Promise<string[] | undefined>;
  /** Override $HOME for tests. */
  homeDir?: string;
}

/**
 * Detect OpenCode's auth state.
 *
 * Layered detection:
 *   1. If `opencode` is not on PATH → `cli-not-installed`.
 *   2. Read `~/.local/share/opencode/auth.json`. Top-level keys are the
 *      authenticated providers. Non-empty → authenticated.
 *   3. If auth.json missing/empty/unparseable, fall back to inferring
 *      providers from the cached `opencode models` output (the prefix
 *      before `/`). Non-empty → authenticated, with the model list also
 *      populated for downstream resolution.
 *   4. Both fail → `unauthenticated` (CLI is there but no creds).
 *
 * Treats malformed auth.json as `unauthenticated`, not `unknown` —
 * unparseable credentials are effectively absent.
 */
export async function detectOpenCodeAuth(
  deps: DetectOpenCodeAuthDeps = {},
): Promise<PlatformAuth> {
  const home = deps.homeDir ?? homedir();
  const authPath = join(home, ".local", "share", "opencode", "auth.json");
  const whichFn =
    deps.whichOpenCode ??
    (async () => (await findOnPath("opencode")) ?? undefined);
  const read = deps.readAuthFile ?? ((p: string) => readFile(p, "utf-8"));
  const getModels = deps.getModels ?? getOpenCodeModels;

  const cliPath = await whichFn();
  const cliInstalled = cliPath !== undefined;
  if (!cliInstalled) {
    return {
      platform: "opencode",
      cliInstalled: false,
      status: "cli-not-installed",
      detail: "opencode CLI not on $PATH",
    };
  }

  // Layer 1: auth.json
  let providers: string[] = [];
  try {
    const raw = await read(authPath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    providers = Object.keys(parsed).filter((k) => k.length > 0);
  } catch {
    // missing, unparseable, or empty — fall through
  }

  if (providers.length > 0) {
    return {
      platform: "opencode",
      cliInstalled: true,
      status: "authenticated",
      detail: `providers: ${providers.join(", ")}`,
    };
  }

  // Layer 2: live models list
  const live = await getModels();
  if (live && live.length > 0) {
    const set = new Set<string>();
    for (const id of live) {
      const idx = id.indexOf("/");
      if (idx > 0) set.add(id.slice(0, idx));
    }
    const inferred = [...set];
    return {
      platform: "opencode",
      cliInstalled: true,
      status: "authenticated",
      availableModels: live,
      detail: `providers (inferred): ${inferred.join(", ")}`,
    };
  }

  // Layer 3: nothing
  return {
    platform: "opencode",
    cliInstalled: true,
    status: "unauthenticated",
    detail: "no providers configured — run `opencode auth login <provider>`",
  };
}
