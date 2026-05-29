import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerSkillsRoute } from "./skills";

let home: string;

async function setup() {
  home = await mkdtemp(join(tmpdir(), "skills-route-"));
  const catRoot = join(home, "cat-a");
  await mkdir(join(catRoot, "skill-x"), { recursive: true });
  await writeFile(
    join(catRoot, "skill-x", "SKILL.md"),
    "---\nname: skill-x\ndescription: hello\n---\nbody",
  );
  await writeFile(
    join(home, "skill-catalogs.json"),
    JSON.stringify({
      version: 1,
      catalogs: [{ kind: "user-global", rootPath: catRoot, label: "a" }],
    }),
  );
  await writeFile(
    join(home, "installed-skills.json"),
    JSON.stringify({ version: 1, installed: [] }),
  );
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerSkillsRoute(app, {
    skillRegistryPath: join(home, "skill-catalogs.json"),
    installedSkillsPath: join(home, "installed-skills.json"),
  });
  app.onError(errorHandler);
  return app;
}

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };

it("GET /api/skills returns all skills across catalogs", async () => {
  const app = await setup();
  const res = await app.request("/api/skills", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as Array<{ name: string; catalogLabel: string }>;
  expect(j[0]?.name).toBe("skill-x");
  expect(j[0]?.catalogLabel).toBe("a");
});

it("GET /api/skill-catalogs returns catalog list", async () => {
  const app = await setup();
  const res = await app.request("/api/skill-catalogs", auth);
  const j = (await res.json()) as Array<{ label: string }>;
  expect(j[0]?.label).toBe("a");
});

it("GET /api/installed-skills returns []", async () => {
  const app = await setup();
  const res = await app.request("/api/installed-skills", auth);
  expect(await res.json()).toEqual([]);
});

it("GET /api/skills/:name returns detail", async () => {
  const app = await setup();
  const res = await app.request("/api/skills/skill-x", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as { body: string; installedOn: string[] };
  expect(j.body).toBe("body");
  expect(j.installedOn).toEqual([]);
});

it("GET /api/skills/:name returns 404 when missing", async () => {
  const app = await setup();
  const res = await app.request("/api/skills/nope", auth);
  expect(res.status).toBe(404);
});

async function setupWithRemoteCatalog() {
  home = await mkdtemp(join(tmpdir(), "skills-route-"));
  const catRoot = join(home, "remote", "github.com", "o", "skills");
  await mkdir(join(catRoot, "skill-y"), { recursive: true });
  await writeFile(
    join(catRoot, "skill-y", "SKILL.md"),
    "---\nname: skill-y\ndescription: hello\n---\nbody",
  );
  await writeFile(
    join(home, "skill-catalogs.json"),
    JSON.stringify({
      version: 2,
      catalogs: [
        {
          kind: "team-shared",
          rootPath: catRoot,
          label: "team",
          gitRemote: "https://github.com/o/skills.git",
          remote: {
            url: "https://github.com/o/skills.git",
            ref: "main",
            lastPulledSha: "a".repeat(40),
            lastPulledAt: "2026-05-25T10:00:00.000Z",
          },
        },
      ],
    }),
  );
  await writeFile(
    join(home, "installed-skills.json"),
    JSON.stringify({ version: 1, installed: [] }),
  );
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerSkillsRoute(app, {
    skillRegistryPath: join(home, "skill-catalogs.json"),
    installedSkillsPath: join(home, "installed-skills.json"),
  });
  app.onError(errorHandler);
  return app;
}

it("GET /api/skills includes remote{} for catalogs cloned from a URL (C4.1.4)", async () => {
  const app = await setupWithRemoteCatalog();
  const res = await app.request("/api/skills", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as Array<{
    name: string;
    remote?: { url: string; ref: string; lastPulledSha?: string };
  }>;
  const sy = j.find((s) => s.name === "skill-y");
  expect(sy?.remote?.url).toBe("https://github.com/o/skills.git");
  expect(sy?.remote?.lastPulledSha).toBe("a".repeat(40));
});

it("GET /api/skills omits remote{} for local catalogs (C4.1.4)", async () => {
  const app = await setup();
  const res = await app.request("/api/skills", auth);
  const j = (await res.json()) as Array<{ name: string; remote?: unknown }>;
  expect(j.find((s) => s.name === "skill-x")?.remote).toBeUndefined();
});
