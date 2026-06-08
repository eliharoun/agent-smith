import type { Platform } from "../../../shared/src/index";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../middleware/error";
import { skillWithRemote } from "../projections/skill-with-remote";
import { loadInstalledSkills } from "../services/installed-skills";
import { loadSkillRemotes } from "../services/load-remotes";
import { runSmith as defaultRunSmith, type SmithRun } from "../services/run-smith";
import { scanSkillBundle } from "../services/scan-skill-bundle";
import { discoverSkills, loadSkillCatalogs } from "../services/scan-skill-catalogs";

export interface SkillsRouteDeps {
  skillRegistryPath: string;
  installedSkillsPath: string;
  runSmith?: (args: string[]) => Promise<SmithRun>;
}

export async function discoverFromUrlHandler(
  kind: "skill" | "agent",
  body: unknown,
  run: (args: string[]) => Promise<SmithRun>,
): Promise<{ status: number; json: unknown }> {
  const b = body as { url?: unknown; ref?: unknown } | null;
  if (!b || typeof b.url !== "string" || b.url.length === 0) return { status: 400, json: { error: "url is required", code: "invalid-url" } };
  if (b.url.startsWith("file://")) return { status: 400, json: { error: "file:// URLs are not allowed from the GUI", code: "invalid-url" } };
  const noun = kind === "skill" ? "skill" : "agent";
  // Flag asymmetry is intentional: the skill CLI uses --git-ref, the agent CLI uses --ref.
  const refFlag = kind === "skill" ? "--git-ref" : "--ref";
  const args = [noun, "install", "--from", b.url, "--json"];
  if (typeof b.ref === "string" && b.ref.length > 0) args.push(refFlag, b.ref);
  const r = await run(args);
  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const err = (parsed as { error: { code: string; message: string } }).error;
    const status = err.code === "invalid-url" || err.code === "invalid-ref" || err.code === "usage-error" ? 400 : 502;
    return { status, json: { error: err.message, code: err.code } };
  }
  if (r.code !== 0 || parsed === null) return { status: 502, json: { error: r.stderr.split("\n").slice(-5).join("\n") || "discovery failed", code: "git-clone-failed" } };
  return { status: 200, json: parsed };
}

export function registerSkillsRoute(app: Hono, deps: SkillsRouteDeps): void {
  const run = deps.runSmith ?? defaultRunSmith;
  app.post("/api/skills/discover-from-url", async (c) => {
    const { status, json } = await discoverFromUrlHandler("skill", await c.req.json().catch(() => null), run);
    return c.json(json as object, status as ContentfulStatusCode);
  });

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
      if (inst?.installedPaths.kiro) installedOn.push("kiro");
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
