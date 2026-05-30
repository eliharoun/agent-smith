import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogList } from "gui-shared";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerCatalogsRoute } from "./catalogs";

let home: string;

async function setup(opts?: { missingAgentRoot?: boolean }) {
  home = await mkdtemp(join(tmpdir(), "catalogs-route-"));
  // Agent catalog (CLI shape) with one bundle.
  const agentRoot = join(home, "agents");
  if (!opts?.missingAgentRoot) {
    await mkdir(join(agentRoot, "bundle-a"), { recursive: true });
    await writeFile(
      join(agentRoot, "bundle-a", "agent.config.json"),
      JSON.stringify({ name: "bundle-a" }),
    );
  }
  await writeFile(
    join(home, "registry.json"),
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "agents-a" }],
    }),
  );
  // Skill catalog with one skill.
  const skillRoot = join(home, "skills");
  await mkdir(join(skillRoot, "skill-x"), { recursive: true });
  await writeFile(
    join(skillRoot, "skill-x", "SKILL.md"),
    "---\nname: skill-x\ndescription: hi\n---\nbody",
  );
  await writeFile(
    join(home, "skill-catalogs.json"),
    JSON.stringify({
      version: 1,
      catalogs: [{ kind: "user-global", rootPath: skillRoot, label: "skills-a" }],
    }),
  );

  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerCatalogsRoute(app, {
    registryPath: join(home, "registry.json"),
    skillRegistryPath: join(home, "skill-catalogs.json"),
  });
  app.onError(errorHandler);
  return app;
}

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };

it("GET /api/catalogs returns combined agent + skill entries", async () => {
  const app = await setup();
  const res = await app.request("/api/catalogs", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as CatalogList;
  expect(j.length).toBe(2);
  const agent = j.find((e) => e.registryKind === "agent");
  const skill = j.find((e) => e.registryKind === "skill");
  expect(agent?.label).toBe("agents-a");
  expect(agent?.health.bundleCount).toBe(1);
  expect(skill?.label).toBe("skills-a");
  expect(skill?.health.skillCount).toBe(1);
});

it("GET /api/catalogs?kind=agent filters to agent only", async () => {
  const app = await setup();
  const res = await app.request("/api/catalogs?kind=agent", auth);
  const j = (await res.json()) as CatalogList;
  expect(j.length).toBe(1);
  expect(j[0]?.registryKind).toBe("agent");
});

it("GET /api/catalogs?kind=skill filters to skill only", async () => {
  const app = await setup();
  const res = await app.request("/api/catalogs?kind=skill", auth);
  const j = (await res.json()) as CatalogList;
  expect(j.length).toBe(1);
  expect(j[0]?.registryKind).toBe("skill");
});

it("[DW-9] single-bundle rootPath reports bundleCount=1", async () => {
  // Remote-installed catalogs (smith agent install --from <url>) clone
  // single-bundle git repos whose agent.config.json sits at the TOP of
  // the clone. Pre-DW-9 countBundles only walked subdirs and reported
  // bundleCount: 0, so the GUI showed remote-installed agents as
  // empty catalogs. Mirror fix to parse-registry's resolveCatalogEntry.
  home = await mkdtemp(join(tmpdir(), "catalogs-route-dw9-"));
  const bundleDir = join(home, "owner-repo");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "agent.config.json"), JSON.stringify({ name: "owner-repo" }));
  await writeFile(
    join(home, "registry.json"),
    JSON.stringify({
      version: 1,
      sources: [{ kind: "registered", rootPath: bundleDir, label: "owner/repo" }],
    }),
  );
  await writeFile(join(home, "skill-catalogs.json"), JSON.stringify({ version: 1, catalogs: [] }));

  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerCatalogsRoute(app, {
    registryPath: join(home, "registry.json"),
    skillRegistryPath: join(home, "skill-catalogs.json"),
  });
  app.onError(errorHandler);

  const res = await app.request("/api/catalogs?kind=agent", auth);
  const j = (await res.json()) as CatalogList;
  expect(j.length).toBe(1);
  expect(j[0]?.health.exists).toBe(true);
  expect(j[0]?.health.bundleCount).toBe(1);
  expect(j[0]?.rootPath).toBe(bundleDir);
});

it("missing rootPath produces exists=false and counts=0", async () => {
  const app = await setup({ missingAgentRoot: true });
  const res = await app.request("/api/catalogs?kind=agent", auth);
  const j = (await res.json()) as CatalogList;
  expect(j[0]?.health.exists).toBe(false);
  expect(j[0]?.health.bundleCount).toBe(0);
});

// [v1-task RC2-7] Mode propagation.
// 'managed' = catalog was cloned by smith (has remote{} block).
// 'linked'  = user-owned path with no smith-managed clone.
// The GUI needs this signal for badge rendering (RC2-8) and to gate
// the --purge-clone destructive affordance to managed catalogs only.
it("[RC2-7] agent entry with remote{} reports mode=managed and remote block", async () => {
  home = await mkdtemp(join(tmpdir(), "catalogs-route-mode-"));
  const agentRoot = join(home, "agents");
  await mkdir(join(agentRoot, "owner-repo"), { recursive: true });
  await writeFile(
    join(agentRoot, "owner-repo", "agent.config.json"),
    JSON.stringify({ name: "owner-repo" }),
  );
  await writeFile(
    join(home, "registry.json"),
    JSON.stringify({
      schemaVersion: 2,
      sources: [
        {
          kind: "registered",
          rootPath: agentRoot,
          label: "owner/repo",
          gitRemote: "https://github.com/owner/repo.git",
          remote: { url: "https://github.com/owner/repo.git", ref: "HEAD" },
        },
      ],
    }),
  );
  await writeFile(join(home, "skill-catalogs.json"), JSON.stringify({ version: 1, catalogs: [] }));
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerCatalogsRoute(app, {
    registryPath: join(home, "registry.json"),
    skillRegistryPath: join(home, "skill-catalogs.json"),
  });
  app.onError(errorHandler);
  const res = await app.request("/api/catalogs?kind=agent", auth);
  const j = (await res.json()) as CatalogList;
  expect(j[0]?.mode).toBe("managed");
  expect(j[0]?.remote?.url).toBe("https://github.com/owner/repo.git");
});

it("[RC2-7] agent entry without remote{} reports mode=linked", async () => {
  const app = await setup(); // default fixture has no remote{}
  const res = await app.request("/api/catalogs?kind=agent", auth);
  const j = (await res.json()) as CatalogList;
  expect(j[0]?.mode).toBe("linked");
  expect(j[0]?.remote).toBeUndefined();
});

it("[RC2-7] skill entry with remote{} reports mode=managed and remote block", async () => {
  home = await mkdtemp(join(tmpdir(), "catalogs-route-skill-mode-"));
  const skillRoot = join(home, "skills");
  await mkdir(join(skillRoot, "skill-x"), { recursive: true });
  await writeFile(
    join(skillRoot, "skill-x", "SKILL.md"),
    "---\nname: skill-x\ndescription: hi\n---\nbody",
  );
  await writeFile(join(home, "registry.json"), JSON.stringify({ version: 1, sources: [] }));
  await writeFile(
    join(home, "skill-catalogs.json"),
    JSON.stringify({
      schemaVersion: 2,
      catalogs: [
        {
          kind: "user-global",
          rootPath: skillRoot,
          label: "team-skills",
          gitRemote: "https://github.com/team/skills.git",
          remote: { url: "https://github.com/team/skills.git", ref: "HEAD" },
        },
      ],
    }),
  );
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerCatalogsRoute(app, {
    registryPath: join(home, "registry.json"),
    skillRegistryPath: join(home, "skill-catalogs.json"),
  });
  app.onError(errorHandler);
  const res = await app.request("/api/catalogs?kind=skill", auth);
  const j = (await res.json()) as CatalogList;
  expect(j[0]?.mode).toBe("managed");
  expect(j[0]?.remote?.url).toBe("https://github.com/team/skills.git");
});

it("[RC2-7] skill entry without remote{} reports mode=linked", async () => {
  const app = await setup(); // default skill fixture has no remote{}
  const res = await app.request("/api/catalogs?kind=skill", auth);
  const j = (await res.json()) as CatalogList;
  expect(j[0]?.mode).toBe("linked");
  expect(j[0]?.remote).toBeUndefined();
});
