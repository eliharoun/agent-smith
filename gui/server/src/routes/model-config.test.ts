import { afterEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelConfig } from "../../../shared/src/index";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerModelConfigRoute } from "./model-config";

let home: string;

async function setup() {
  home = await mkdtemp(join(tmpdir(), "model-cfg-route-"));
  const smithEnvPath = join(home, ".env");
  const authJsonPath = join(home, "auth.json");
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerModelConfigRoute(app, {
    smithEnvPath,
    authJsonPath,
    getOpenCodeModels: async () => [
      "github-copilot/claude-opus-4.7",
      "github-copilot/claude-sonnet-4.6",
      "github-copilot/claude-haiku-4.5",
    ],
    env: {},
  });
  app.onError(errorHandler);
  return { app, smithEnvPath, authJsonPath };
}

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };

it("GET /api/model-config returns valid ModelConfig", async () => {
  const { app, authJsonPath } = await setup();
  await writeFile(authJsonPath, JSON.stringify({ "github-copilot": {} }));
  const res = await app.request("/api/model-config", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as ModelConfig;
  expect(j.detectedProviders).toContain("github-copilot");
  expect(j.tierPreview.length).toBe(3);
  expect(j.tierOverrides).toEqual({ high: null, balanced: null, fast: null });
});

it("PUT /api/model-config writes preferences and returns updated config", async () => {
  const { app, smithEnvPath } = await setup();
  const res = await app.request("/api/model-config", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ preferenceOrder: ["anthropic", "openrouter"] }),
  });
  expect(res.status).toBe(200);
  const j = (await res.json()) as ModelConfig;
  expect(j.preferenceOrder[0].provider).toBe("anthropic");
  expect(j.preferenceOrder[0].source).toBe("file");
  const raw = await readFile(smithEnvPath, "utf8");
  expect(raw).toContain("SMITH_MODEL_PROVIDERS=anthropic,openrouter");
});

it("PUT /api/model-config rejects invalid body with 400", async () => {
  const { app } = await setup();
  const res = await app.request("/api/model-config", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ preferenceOrder: 123 }),
  });
  expect(res.status).toBe(400);
});

it("PUT /api/model-config writes tier overrides", async () => {
  const { app, smithEnvPath } = await setup();
  const res = await app.request("/api/model-config", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      tierOverrides: { high: "anthropic/custom-opus", balanced: null, fast: null },
    }),
  });
  expect(res.status).toBe(200);
  const j = (await res.json()) as ModelConfig;
  expect(j.tierOverrides.high).toBe("anthropic/custom-opus");
  const raw = await readFile(smithEnvPath, "utf8");
  expect(raw).toContain("SMITH_TIER_HIGH=anthropic/custom-opus");
});
