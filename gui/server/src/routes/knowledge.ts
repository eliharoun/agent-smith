import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKnowledgeView, SourceJoined } from "../../../shared/src/index";
import type { Hono } from "hono";
import { z } from "zod";
import { writeRefreshManifest } from "../../../../src/core/knowledge/refresh-manifest";
import { detectInstalledPlatforms as defaultDetectInstalledPlatforms } from "../../../../src/io/platform-detect";
import { HttpError } from "../middleware/error";
import { parseKnowledgeConfig } from "../services/parse-knowledge-config";
import {
  loadKnowledgeManifest,
  loadRefreshCacheEntries,
} from "../services/parse-knowledge-manifest";
import { parseKnowledgeUrl } from "../services/parse-knowledge-url";
import { loadRefreshConsent } from "../services/parse-refresh-manifest";
import { parseRegistrySources } from "../services/parse-registry";
import { buildRefreshSummary } from "../services/refresh-summary";

export interface KnowledgeRouteDeps {
  registryPath: string;
  agentSmithHome?: string;
  cacheRoot?: string;
  /**
   * Probe for installed platform CLIs. Defaults to the production
   * `detectInstalledPlatforms` from `src/io/platform-detect.ts`. Tests
   * inject a fixed Set so they don't depend on the real PATH.
   */
  detectInstalledPlatforms?: () => Promise<Set<PlatformId>>;
}

const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

// Mirror of PLATFORM_IDS in src/io/platform-detect.ts. Inlined because
// gui/server cannot cross-import (rootDir boundary). Kept in lockstep.
const PLATFORM_IDS = ["opencode", "claude-code", "codex", "kiro"] as const;
type PlatformId = (typeof PLATFORM_IDS)[number];

const PutConsentBody = z.object({
  platforms: z.array(z.enum(PLATFORM_IDS)),
  sources: z.array(z.string().min(1)),
});

function defaultAgentSmithHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".config", "agent-smith");
}

interface ConsentInput {
  platforms: PlatformId[];
  sources: string[];
}

/**
 * Writes a RefreshManifest to <agentSmithHome>/refresh/<agent>/refresh-manifest.json.
 * The writer in src/core/knowledge/refresh-manifest.ts handles all the
 * assertWithin / mkdir-recursive details.
 */
async function writeRefreshConsent(
  agentSmithHome: string,
  agent: string,
  input: ConsentInput,
): Promise<void> {
  await writeRefreshManifest(agentSmithHome, agent, {
    schemaVersion: 1,
    agent,
    refresh_consent: {
      granted_at: new Date().toISOString(),
      platforms: input.platforms,
      sources: input.sources,
    },
  });
}

async function locateBundleDir(agent: string, registryPath: string): Promise<string | null> {
  const sources = await parseRegistrySources(registryPath);
  for (const src of sources) {
    const dir = join(src.rootPath, agent);
    const cfg = join(dir, "agent.config.json");
    try {
      if ((await stat(cfg)).isFile()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

export function registerKnowledgeRoute(app: Hono, deps: KnowledgeRouteDeps): void {
  // NOTE: register this BEFORE /:agent so the static path takes precedence
  // even though "refresh-summary" would also match the AGENT_NAME_RE.
  app.get("/api/knowledge/refresh-summary", async (c) => {
    const summaries = await buildRefreshSummary({
      registryPath: deps.registryPath,
      ...(deps.agentSmithHome !== undefined ? { agentSmithHome: deps.agentSmithHome } : {}),
      ...(deps.cacheRoot !== undefined ? { cacheRoot: deps.cacheRoot } : {}),
    });
    return c.json({ summaries });
  });

  app.get("/api/knowledge/:agent", async (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_NAME_RE.test(agent)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${agent}`);
    }
    const bundleDir = await locateBundleDir(agent, deps.registryPath);
    if (!bundleDir) {
      throw new HttpError(404, "NOT_FOUND", `agent ${agent} not registered`);
    }
    const cfg = await parseKnowledgeConfig({
      configPath: join(bundleDir, "agent.config.json"),
    });
    const manifest = await loadKnowledgeManifest(agent, deps.agentSmithHome);
    const cache = await loadRefreshCacheEntries(agent, deps.cacheRoot);
    const consent = await loadRefreshConsent(agent, deps.agentSmithHome);

    const sources: SourceJoined[] = cfg.sources.map((s) => {
      const manifestEntry = manifest?.sources.find((m) => m.id === s.id);
      const refreshCache = cache[s.id];
      return {
        source: s,
        ...(manifestEntry !== undefined ? { manifestEntry } : {}),
        ...(refreshCache !== undefined ? { refreshCache } : {}),
      };
    });

    const view: AgentKnowledgeView = {
      agent,
      sources,
      ...(manifest?.totals !== undefined ? { totals: manifest.totals } : {}),
      ...(consent?.refresh_consent !== undefined ? { consent: consent.refresh_consent } : {}),
    };
    return c.json(view);
  });

  app.get("/api/knowledge/:agent/refresh-history", async (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_NAME_RE.test(agent)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${agent}`);
    }
    const cache = await loadRefreshCacheEntries(agent, deps.cacheRoot);
    const consent = await loadRefreshConsent(agent, deps.agentSmithHome);
    return c.json({
      agent,
      ...(consent?.refresh_consent !== undefined ? { consent: consent.refresh_consent } : {}),
      entries: Object.entries(cache).map(([sourceId, entry]) => ({
        sourceId,
        ...entry,
      })),
    });
  });

  app.put("/api/knowledge/:agent/consent", async (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_NAME_RE.test(agent)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${agent}`);
    }
    const bundleDir = await locateBundleDir(agent, deps.registryPath);
    if (!bundleDir) {
      throw new HttpError(404, "NOT_FOUND", `agent ${agent} not registered`);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = PutConsentBody.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    // Defense in depth: even if a buggy client sends platforms whose CLIs
    // aren't installed, never let them land in the consent manifest. They
    // would only show up later as orphaned-consent doctor findings.
    const detect = deps.detectInstalledPlatforms ?? defaultDetectInstalledPlatforms;
    const installed = await detect();
    const filteredPlatforms = parsed.data.platforms.filter((p) => installed.has(p));
    const dropped = parsed.data.platforms.filter((p) => !installed.has(p));
    if (dropped.length > 0) {
      process.stderr.write(
        `[consent] dropped uninstalled platforms from consent for agent ${agent}: ${dropped.join(", ")}\n`,
      );
    }
    const home = deps.agentSmithHome ?? defaultAgentSmithHome();
    await writeRefreshConsent(home, agent, {
      platforms: filteredPlatforms,
      sources: parsed.data.sources,
    });
    return c.json({ ok: true });
  });

  app.post("/api/knowledge/parse-url", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ url: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    try {
      return c.json(parseKnowledgeUrl(parsed.data.url));
    } catch (err) {
      throw new HttpError(400, "BAD_REQUEST", (err as Error).message);
    }
  });
}
