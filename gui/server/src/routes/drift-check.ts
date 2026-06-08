import type { Platform } from "../../../shared/src/index";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { type DryRunDeps, type DryRunOutput, renderDryRun } from "../services/render-dry-run";
import { type InstallStateEntry, loadInstallStateEntries } from "./install-state";

export interface DriftCheckDeps {
  /** Directory containing `installed-agents.json`. */
  agentSmithHome: string;
  /** Registry path passed through to the dry-run service. */
  registryPath: string;
  /** Test seam — drift-check.test.ts injects a stub renderer. */
  renderDryRun?: (
    input: { agent: string; targets?: readonly Platform[] },
    deps: DryRunDeps,
  ) => Promise<DryRunOutput>;
  /** Test seam — read manifest entries via an injectable function. */
  loadEntries?: (home: string, agent: string) => Promise<InstallStateEntry[]>;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  "opencode",
  "claude-code",
  "codex",
  "kiro",
]);

export interface DriftCheckResponse {
  drifted: Platform[];
}

export function registerDriftCheckRoute(app: Hono, deps: DriftCheckDeps) {
  const dryRun = deps.renderDryRun ?? renderDryRun;
  const loadEntries = deps.loadEntries ?? loadInstallStateEntries;

  app.get("/api/agents/:name/drift-check", async (c) => {
    const name = c.req.param("name");
    if (!NAME_PATTERN.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    const entries = await loadEntries(deps.agentSmithHome, name);
    // Drift is computed over MAIN entries only. Sidecar files are auxiliary
    // (e.g. Codex's `agents/openai.yaml`) — we'd need a parallel dry-run
    // path that emits sidecar bytes to compare them, and the GUI's
    // Re-install button doesn't act on sidecars independently anyway.
    const mainByPlatform = new Map<Platform, InstallStateEntry>();
    for (const e of entries) {
      if (e.kind !== "main") continue;
      if (!PLATFORMS.has(e.platform as Platform)) continue;
      mainByPlatform.set(e.platform as Platform, e);
    }
    if (mainByPlatform.size === 0) {
      const empty: DriftCheckResponse = { drifted: [] };
      return c.json(empty);
    }

    const installedPlatforms = Array.from(mainByPlatform.keys());
    let dryRunOutput: DryRunOutput;
    try {
      dryRunOutput = await dryRun(
        { agent: name, targets: installedPlatforms },
        { registryPath: deps.registryPath },
      );
    } catch (err) {
      // Surface render failures (broken config, missing bundle, etc.)
      // as 500. Returning "drifted: all" would be a lie — the user's
      // bundle is broken, not drifted, and Re-install would fail too.
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(500, "RENDER_FAILED", message);
    }

    const freshHashByPlatform = new Map<Platform, string>();
    for (const h of dryRunOutput.hashes) {
      if (h.kind !== "main") continue;
      freshHashByPlatform.set(h.platform, h.hash);
    }

    const drifted: Platform[] = [];
    for (const [platform, entry] of mainByPlatform) {
      const fresh = freshHashByPlatform.get(platform);
      if (fresh === undefined) {
        // The bundle no longer declares this target — definitely drifted.
        // (E.g. user removed `claude-code` from `targets`; the installed
        // file is now stale.)
        drifted.push(platform);
        continue;
      }
      if (fresh !== entry.contentHash) {
        drifted.push(platform);
      }
    }
    drifted.sort();
    const response: DriftCheckResponse = { drifted };
    return c.json(response);
  });
}
