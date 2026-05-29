/**
 * Lists every Atlassian-backed knowledge source across all registered
 * agents. Used by the /system/atlassian-setup screen so users can see
 * exactly which agents' knowledge will be affected when they change
 * their Atlassian credentials.
 *
 * Soft-fails per agent (missing bundle / malformed knowledge.yml) — those
 * agents are simply omitted.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseKnowledgeConfig } from "./parse-knowledge-config";
import { parseRegistrySources } from "./parse-registry";

export interface AffectedSource {
  agent: string;
  sourceId: string;
  type: "confluence" | "jira";
  /** Compact human label: space / jql for surfacing in the row. */
  label?: string;
}

export interface AffectedSourcesDeps {
  registryPath: string;
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

async function listRegisteredAgents(registryPath: string): Promise<string[]> {
  const sources = await parseRegistrySources(registryPath);
  const out = new Set<string>();
  for (const src of sources) {
    try {
      const entries = await readdir(src.rootPath);
      for (const name of entries) {
        const cfg = join(src.rootPath, name, "agent.config.json");
        try {
          if ((await stat(cfg)).isFile()) out.add(name);
        } catch {
          // not an agent dir; skip
        }
      }
    } catch {
      // unreadable catalog; skip
    }
  }
  return [...out].sort();
}

export async function buildAffectedSources(deps: AffectedSourcesDeps): Promise<AffectedSource[]> {
  const agents = await listRegisteredAgents(deps.registryPath);
  const out: AffectedSource[] = [];
  for (const agent of agents) {
    const bundleDir = await locateBundleDir(agent, deps.registryPath);
    if (!bundleDir) continue;
    try {
      const cfg = await parseKnowledgeConfig({
        configPath: join(bundleDir, "agent.config.json"),
      });
      for (const src of cfg.sources) {
        if (src.type === "confluence") {
          out.push({
            agent,
            sourceId: src.id,
            type: "confluence",
            label: src.space,
          });
        } else if (src.type === "jira") {
          out.push({
            agent,
            sourceId: src.id,
            type: "jira",
            label: src.jql,
          });
        }
      }
    } catch {
      // malformed knowledge.yml → skip this agent
    }
  }
  return out;
}
