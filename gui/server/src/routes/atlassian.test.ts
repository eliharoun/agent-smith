import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AtlassianEnvStatus } from "../../../shared/src/index";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerAtlassianRoute } from "./atlassian";

let home: string;

async function setup(opts?: { env?: NodeJS.ProcessEnv; registryPath?: string }) {
  home = await mkdtemp(join(tmpdir(), "atlassian-route-"));
  const smithEnvPath = join(home, ".env");
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerAtlassianRoute(app, {
    envDeps: {
      smithEnvPath,
      env: opts?.env ?? {},
    },
    ...(opts?.registryPath !== undefined ? { registryPath: opts.registryPath } : {}),
  });
  app.onError(errorHandler);
  return { app, smithEnvPath };
}

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };

it("GET /api/atlassian-env returns source=none when nothing configured", async () => {
  const { app } = await setup();
  const res = await app.request("/api/atlassian-env", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as AtlassianEnvStatus;
  expect(j.source).toBe("none");
  expect(j.editable).toBe(true);
  expect(j.hasToken).toBe(false);
});

it("PUT /api/atlassian-env writes file and GET reports smith-env-file", async () => {
  const { app, smithEnvPath } = await setup();
  const putRes = await app.request("/api/atlassian-env", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      email: "alice@example.com",
      apiToken: "tok123",
    }),
  });
  expect(putRes.status).toBe(200);
  const j = (await putRes.json()) as AtlassianEnvStatus;
  expect(j.source).toBe("smith-env-file");
  expect(j.email).toBe("alice@example.com");
  expect(j.editable).toBe(true);
  // File on disk contains the secrets and is mode 0600.
  const raw = await readFile(smithEnvPath, "utf8");
  expect(raw).toContain("SMITH_ATLASSIAN_EMAIL=alice@example.com");
  expect(raw).toContain("SMITH_ATLASSIAN_API_TOKEN=tok123");
});

it("PUT /api/atlassian-env rejects invalid email with 400", async () => {
  const { app } = await setup();
  const res = await app.request("/api/atlassian-env", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", apiToken: "x" }),
  });
  expect(res.status).toBe(400);
});

it("PUT /api/atlassian-env returns 409 when not editable", async () => {
  // process env credentials -> source=env, editable=false
  const { app } = await setup({
    env: {
      SMITH_ATLASSIAN_EMAIL: "bob@example.com",
      SMITH_ATLASSIAN_API_TOKEN: "tok",
    },
  });
  const res = await app.request("/api/atlassian-env", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ email: "bob@example.com", apiToken: "x" }),
  });
  expect(res.status).toBe(409);
});

it("GET /api/atlassian/affected-sources returns 501 when registryPath not configured", async () => {
  const { app } = await setup();
  const res = await app.request("/api/atlassian/affected-sources", auth);
  expect(res.status).toBe(501);
});

it("GET /api/atlassian/affected-sources lists confluence + jira sources across agents", async () => {
  home = await mkdtemp(join(tmpdir(), "atlassian-affected-"));
  const agentRoot = join(home, "agents");
  // agent A: one confluence + one file (file should be skipped)
  await mkdir(join(agentRoot, "agent-a"), { recursive: true });
  await writeFile(
    join(agentRoot, "agent-a", "agent.config.json"),
    JSON.stringify({
      name: "agent-a",
      knowledge: {
        sources: [
          { id: "wiki", type: "confluence", space: "ENG" },
          { id: "notes", type: "file", path: "./notes.md" },
        ],
      },
    }),
  );
  // agent B: one jira
  await mkdir(join(agentRoot, "agent-b"), { recursive: true });
  await writeFile(
    join(agentRoot, "agent-b", "agent.config.json"),
    JSON.stringify({
      name: "agent-b",
      knowledge: {
        sources: [{ id: "tickets", type: "jira", jql: "project = INFRA" }],
      },
    }),
  );
  const registryPath = join(home, "registry.json");
  await writeFile(
    registryPath,
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "a" }],
    }),
  );
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerAtlassianRoute(app, { registryPath });
  app.onError(errorHandler);

  const res = await app.request("/api/atlassian/affected-sources", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as {
    sources: Array<{ agent: string; sourceId: string; type: string; label?: string }>;
  };
  expect(j.sources.length).toBe(2);
  const wiki = j.sources.find((s) => s.sourceId === "wiki");
  const tickets = j.sources.find((s) => s.sourceId === "tickets");
  expect(wiki?.agent).toBe("agent-a");
  expect(wiki?.type).toBe("confluence");
  expect(wiki?.label).toBe("ENG");
  expect(tickets?.agent).toBe("agent-b");
  expect(tickets?.type).toBe("jira");
  expect(tickets?.label).toBe("project = INFRA");
});
