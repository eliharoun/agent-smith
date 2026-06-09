import { stat } from "node:fs/promises";
import type { CatalogEntry, CatalogKindAny, CatalogList, CatalogMode } from "../../../shared/src/index";
import type { Hono } from "hono";
import { isProtectedCatalog } from "../../../../src/core/protected-bundles";
import { discoverAgentBundleDirs } from "../../../../src/io/sources";
import { parseRegistrySources } from "../services/parse-registry";
import { discoverSkills, loadSkillCatalogs } from "../services/scan-skill-catalogs";

export interface CatalogsRouteDeps {
  registryPath: string;
  skillRegistryPath: string;
}

const AGENT_KINDS = new Set<CatalogKindAny>(["user-global", "project", "registered"]);

function coerceAgentKind(raw: string): CatalogKindAny {
  return AGENT_KINDS.has(raw as CatalogKindAny) ? (raw as CatalogKindAny) : "registered";
}

// [v1-task RC2-7] Inline mirror of src/core/source-mode.ts:catalogMode.
// gui/server cannot import from ../../../src (cross-package boundary), so
// duplicate the one-liner here. Single source of truth lives in the CLI
// package; if the rule ever grows beyond `remote !== undefined`, update
// both. Trivially asserted by routes/catalogs.test.ts coverage of both
// modes for both registryKinds.
function catalogMode(s: { remote?: unknown }): CatalogMode {
  return s.remote !== undefined ? "managed" : "linked";
}

export function registerCatalogsRoute(app: Hono, deps: CatalogsRouteDeps): void {
  app.get("/api/catalogs", async (c) => {
    const kindFilter = c.req.query("kind");
    const out: CatalogList = [];

    if (kindFilter !== "skill") {
      const sources = await parseRegistrySources(deps.registryPath);
      for (const src of sources) {
        const exists = await dirExists(src.rootPath);
        const bundleCount = exists ? await countBundles(src.rootPath) : 0;
        const entry: CatalogEntry = {
          registryKind: "agent",
          kind: coerceAgentKind(src.kind),
          mode: catalogMode(src),
          label: src.label,
          rootPath: src.rootPath,
          health: { exists, bundleCount },
          ...(src.gitRemote !== undefined ? { gitRemote: src.gitRemote } : {}),
          ...(src.remote !== undefined ? { remote: src.remote } : {}),
          // Surface the synthetic agent-smith-self source as a protected,
          // read-only catalog row (CatalogList already gates on `protected`).
          ...(isProtectedCatalog(src.label) ? { protected: true } : {}),
        };
        out.push(entry);
      }
    }

    if (kindFilter !== "agent") {
      const cats = await loadSkillCatalogs({ registryPath: deps.skillRegistryPath });
      for (const cat of cats) {
        const exists = await dirExists(cat.rootPath);
        const skillCount = exists ? (await discoverSkills(cat)).length : 0;
        const entry: CatalogEntry = {
          registryKind: "skill",
          kind: cat.kind,
          mode: catalogMode(cat),
          label: cat.label,
          rootPath: cat.rootPath,
          health: { exists, skillCount },
          ...(cat.gitRemote !== undefined ? { gitRemote: cat.gitRemote } : {}),
          ...(cat.remote !== undefined ? { remote: cat.remote } : {}),
          ...(cat.adhoc !== undefined ? { adhoc: cat.adhoc } : {}),
          ...(cat.protected !== undefined ? { protected: cat.protected } : {}),
        };
        out.push(entry);
      }
    }

    return c.json(out);
  });
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function countBundles(root: string): Promise<number> {
  // Reuse the CLI's recursive discovery so /api/catalogs bundleCount matches
  // what `smith agent list` and /api/agents report (single source of truth).
  // discoverAgentBundleDirs already counts a single-bundle root.
  return (await discoverAgentBundleDirs(root)).length;
}
