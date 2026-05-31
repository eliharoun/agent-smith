import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentConfigPatch,
  type AgentSummary,
  PersonaContent,
  PersonaFile,
  type Platform,
} from "gui-shared";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { atomicWriteText } from "../io/atomic-write";
import { HttpError } from "../middleware/error";
import { agentWithRemote } from "../projections/agent-with-remote";
import { computeInstalledStatus } from "../services/installed-status";
import { loadAgentRemotes } from "../services/load-remotes";
import { parseRegistry, type Registry } from "../services/parse-registry";
import { runSmith as defaultRunSmith, type SmithRun } from "../services/run-smith";
import { scanBundle } from "../services/scan-bundle";
import { discoverFromUrlHandler } from "./skills";

export interface AgentsDeps {
  registryPath: string;
  installPathsFor: (agent: string) => Record<Platform, string>;
  runSmith?: (args: string[]) => Promise<SmithRun>;
}

/**
 * Find every catalog in the registry that contains the named agent.
 * If more than one match exists, emit a single console.warn surfacing the
 * ambiguity. Selection semantics are unchanged: the first catalog (by
 * `Object.entries` iteration order) wins.
 */
function findAgentMatches(reg: Registry, name: string): Array<{ catalog: string; path: string }> {
  const matches: Array<{ catalog: string; path: string }> = [];
  for (const [catalog, info] of Object.entries(reg.catalogs)) {
    if (info.agents.includes(name)) {
      matches.push({ catalog, path: join(info.path, name) });
    }
  }
  if (matches.length > 1) {
    // matches.length > 1 guarantees matches[0] is defined; use optional
    // chaining + fallback to satisfy biome's noNonNullAssertion without
    // weakening the message.
    const winner = matches[0]?.catalog ?? "<unknown>";
    console.warn(
      `[agents] duplicate "${name}" in catalogs ${matches
        .map((m) => m.catalog)
        .join(", ")}; using ${winner}`,
    );
  }
  return matches;
}

export function registerAgentsRoutes(app: Hono, deps: AgentsDeps) {
  const run = deps.runSmith ?? defaultRunSmith;
  app.post("/api/agents/discover-from-url", async (c) => {
    const { status, json } = await discoverFromUrlHandler(
      "agent",
      await c.req.json().catch(() => null),
      run,
    );
    return c.json(json as object, status as ContentfulStatusCode);
  });

  app.get("/api/agents", async (c) => {
    const [reg, remotes] = await Promise.all([
      parseRegistry(deps.registryPath),
      loadAgentRemotes(deps.registryPath),
    ]);
    const tasks: Array<Promise<AgentSummary | null>> = [];
    for (const [catalog, info] of Object.entries(reg.catalogs)) {
      for (const name of info.agents) {
        tasks.push(
          scanBundle({ name, catalog, path: join(info.path, name) })
            .then((detail): AgentSummary => {
              const summary: AgentSummary = {
                name: detail.name,
                description: detail.description,
                catalog: detail.catalog,
                path: detail.path,
                targets: detail.targets,
              };
              if (detail.model !== undefined) summary.model = detail.model;
              return agentWithRemote(summary, remotes);
            })
            .catch((err: unknown) => {
              console.warn(`[agents] skip ${catalog}/${name}: ${(err as Error).message}`);
              return null;
            }),
        );
      }
    }
    const results = await Promise.all(tasks);
    const summaries = results.filter((s): s is AgentSummary => s !== null);
    return c.json(summaries);
  });

  app.get("/api/agents/:name", async (c) => {
    const name = c.req.param("name");
    const [reg, remotes] = await Promise.all([
      parseRegistry(deps.registryPath),
      loadAgentRemotes(deps.registryPath),
    ]);
    const matches = findAgentMatches(reg, name);
    const first = matches[0];
    if (!first) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
    }
    try {
      const detail = await scanBundle({ name, catalog: first.catalog, path: first.path });
      // C4.1.4: project the remote{} block onto the detail response so the
      // detail page can render the badge without a second round-trip.
      const projected = agentWithRemote(
        {
          name: detail.name,
          description: detail.description,
          catalog: detail.catalog,
          path: detail.path,
          targets: detail.targets,
          ...(detail.model !== undefined ? { model: detail.model } : {}),
        },
        remotes,
      );
      return c.json({ ...detail, ...(projected.remote ? { remote: projected.remote } : {}) });
    } catch (err) {
      throw new HttpError(500, "BUNDLE_READ_ERROR", (err as Error).message);
    }
  });

  app.get("/api/agents/:name/installed-status", async (c) => {
    const name = c.req.param("name");
    const reg = await parseRegistry(deps.registryPath);
    const exists = Object.values(reg.catalogs).some((info) => info.agents.includes(name));
    if (!exists) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
    }
    const paths = deps.installPathsFor(name);
    const status = await computeInstalledStatus({ agent: name, paths });
    return c.json(status);
  });

  // Atomic per-tab persona write. Validates :file against the canonical
  // four-name enum, looks up the bundle path via the registry (404 if the
  // agent is unknown), and writes <bundle>/<FILE>.md via temp+rename.
  app.put("/api/agents/:name/persona/:file", async (c) => {
    const name = c.req.param("name");
    const fileParam = c.req.param("file");
    const fileParsed = PersonaFile.safeParse(fileParam);
    if (!fileParsed.success) {
      throw new HttpError(400, "BAD_REQUEST", `invalid persona file: ${fileParam}`);
    }
    const body = await c.req.json().catch(() => null);
    const bodyParsed = PersonaContent.safeParse(body);
    if (!bodyParsed.success) {
      throw new HttpError(400, "BAD_REQUEST", bodyParsed.error.message);
    }
    const reg = await parseRegistry(deps.registryPath);
    const matches = findAgentMatches(reg, name);
    const first = matches[0];
    if (!first) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
    }
    const target = join(first.path, `${fileParsed.data}.md`);
    try {
      await atomicWriteText(target, bodyParsed.data.content);
    } catch (err) {
      throw new HttpError(500, "WRITE_FAILED", (err as Error).message);
    }
    return c.json({ ok: true });
  });

  // Atomic config patch: update `targets` and/or `modelTier` in the bundle's
  // agent.config.json. Validates the patch shape, merges into the existing
  // config, and writes via temp+rename.
  app.put("/api/agents/:name/config", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json().catch(() => null);
    const parsed = AgentConfigPatch.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    const reg = await parseRegistry(deps.registryPath);
    const matches = findAgentMatches(reg, name);
    const first = matches[0];
    if (!first) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
    }
    const configPath = join(first.path, "agent.config.json");
    let current: Record<string, unknown>;
    try {
      current = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      throw new HttpError(500, "BUNDLE_READ_ERROR", (err as Error).message);
    }
    const next = { ...current };
    if (parsed.data.targets !== undefined) next.targets = parsed.data.targets;
    if (parsed.data.modelTier !== undefined) next.modelTier = parsed.data.modelTier;
    try {
      await atomicWriteText(configPath, `${JSON.stringify(next, null, 2)}\n`);
    } catch (err) {
      throw new HttpError(500, "WRITE_FAILED", (err as Error).message);
    }
    return c.json({ ok: true });
  });
}
