import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { assertWithin } from "../../../../src/io/assert-within";
import { knowledgeDirFor } from "../../../../src/io/knowledge-paths";
import { HttpError } from "../middleware/error";
import { parseRegistrySources } from "../services/parse-registry";

export interface KnowledgeCacheDeps {
  /** Root of agent-smith's state home (where `knowledge/<agent>/...` lives). */
  agentSmithHome: string;
  /** Registry path used to verify the agent is registered. */
  registryPath: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
// Source ids: alphanumerics + dash/underscore/dot, no slashes, no leading dot.
// Refuses "..", "../foo", absolute paths, and URL-encoded traversal already
// rejected by the regex on the decoded value.
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

async function isAgentRegistered(registryPath: string, agent: string): Promise<boolean> {
  const sources = await parseRegistrySources(registryPath);
  for (const src of sources) {
    try {
      const cfg = join(src.rootPath, agent, "agent.config.json");
      const s = await stat(cfg);
      if (s.isFile()) return true;
    } catch {
      // continue
    }
  }
  return false;
}

function sourceCacheDir(home: string, agent: string, sourceId: string): string {
  return join(knowledgeDirFor(agent, { agentSmithHome: home }), "sources", sourceId);
}

export function registerKnowledgeCacheRoute(app: Hono, deps: KnowledgeCacheDeps): void {
  app.delete("/api/agents/:name/knowledge/sources/:id/cache", async (c) => {
    const name = c.req.param("name");
    const id = c.req.param("id");
    if (!NAME_PATTERN.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    if (!SOURCE_ID_PATTERN.test(id)) {
      throw new HttpError(400, "INVALID_SOURCE_ID", `invalid source id: ${id}`);
    }
    if (!(await isAgentRegistered(deps.registryPath, name))) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not registered`);
    }
    const target = sourceCacheDir(deps.agentSmithHome, name, id);
    // Belt-and-suspenders: assertWithin checks containment against the
    // canonical agent-smith home even if a future caller bypasses the
    // pattern guards above. Skip when the target doesn't exist (idempotent).
    try {
      await stat(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return c.body(null, 204);
      }
      throw err;
    }
    await assertWithin(target, deps.agentSmithHome);
    await rm(target, { recursive: true, force: true });
    return c.body(null, 204);
  });

  app.get("/api/agents/:name/knowledge/sources/:id/cache-status", async (c) => {
    const name = c.req.param("name");
    const id = c.req.param("id");
    if (!NAME_PATTERN.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    if (!SOURCE_ID_PATTERN.test(id)) {
      throw new HttpError(400, "INVALID_SOURCE_ID", `invalid source id: ${id}`);
    }
    if (!(await isAgentRegistered(deps.registryPath, name))) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not registered`);
    }
    const target = sourceCacheDir(deps.agentSmithHome, name, id);
    let hasCachedFiles = false;
    try {
      const entries = await readdir(target);
      hasCachedFiles = entries.length > 0;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return c.json({ hasCachedFiles });
  });
}
