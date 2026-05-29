import type { Platform } from "gui-shared";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { skillWithRemote } from "../projections/skill-with-remote";
import { loadInstalledSkills } from "../services/installed-skills";
import { loadSkillRemotes } from "../services/load-remotes";
import { scanSkillBundle } from "../services/scan-skill-bundle";
import { discoverSkills, loadSkillCatalogs } from "../services/scan-skill-catalogs";

export interface SkillsRouteDeps {
  skillRegistryPath: string;
  installedSkillsPath: string;
}

export function registerSkillsRoute(app: Hono, deps: SkillsRouteDeps): void {
  app.get("/api/skills", async (c) => {
    const [cats, remotes] = await Promise.all([
      loadSkillCatalogs({ registryPath: deps.skillRegistryPath }),
      loadSkillRemotes(deps.skillRegistryPath),
    ]);
    const all = (await Promise.all(cats.map(discoverSkills))).flat();
    // C4.1.4: project remote{} onto each summary via skillWithRemote.
    return c.json(all.map((s) => skillWithRemote(s, remotes)));
  });

  app.get("/api/skill-catalogs", async (c) => {
    const cats = await loadSkillCatalogs({ registryPath: deps.skillRegistryPath });
    return c.json(cats);
  });

  app.get("/api/installed-skills", async (c) => {
    const installed = await loadInstalledSkills({ path: deps.installedSkillsPath });
    return c.json(installed);
  });

  app.get("/api/skills/:name", async (c) => {
    const name = c.req.param("name");
    const [cats, installed, remotes] = await Promise.all([
      loadSkillCatalogs({ registryPath: deps.skillRegistryPath }),
      loadInstalledSkills({ path: deps.installedSkillsPath }),
      loadSkillRemotes(deps.skillRegistryPath),
    ]);
    for (const cat of cats) {
      const summaries = await discoverSkills(cat);
      const hit = summaries.find((s) => s.name === name);
      if (!hit) continue;
      const inst = installed.find((i) => i.name === name);
      const installedOn: Platform[] = [];
      if (inst?.installedPaths.opencode) installedOn.push("opencode");
      if (inst?.installedPaths.claudeCode) installedOn.push("claude-code");
      if (inst?.installedPaths.codex) installedOn.push("codex");
      try {
        const detail = await scanSkillBundle({
          path: hit.path,
          catalogLabel: cat.label,
          installedOn,
        });
        // C4.1.4: surface remote{} on the detail response too so the
        // skill detail page can render the badge without a second call.
        const projected = skillWithRemote(hit, remotes);
        return c.json({
          ...detail,
          ...(projected.remote ? { remote: projected.remote } : {}),
        });
      } catch (err) {
        throw new HttpError(500, "BUNDLE_READ_ERROR", (err as Error).message);
      }
    }
    throw new HttpError(404, "NOT_FOUND", `skill ${name} not found in any catalog`);
  });
}
