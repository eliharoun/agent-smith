import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "registry-route-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeJobs(): JobManager {
  return new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
}

describe("GET /api/registry", () => {
  it("returns the parsed registry contents on the happy path", async () => {
    const registryPath = join(root, "registry.json");
    const registry = {
      schemaVersion: 1,
      catalogs: {
        "test-catalog": {
          path: "/some/path",
          agents: [
            { name: "alpha", relPath: "alpha" },
            { name: "beta", relPath: "beta" },
          ],
        },
      },
    };
    await writeFile(registryPath, JSON.stringify(registry));
    const app = createApp({ token: "t", jobs: makeJobs(), registryPath });
    const res = await app.request("/api/registry", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      catalogs: Record<
        string,
        { path: string; agents: Array<{ name: string; relPath: string }> }
      >;
    };
    expect(body.catalogs).toEqual(registry.catalogs);
  });

  it("returns an empty registry when the file is missing (parseRegistry self-heals)", async () => {
    const registryPath = join(root, "does-not-exist.json");
    const app = createApp({ token: "t", jobs: makeJobs(), registryPath });
    const res = await app.request("/api/registry", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { catalogs: Record<string, unknown> };
    expect(body.catalogs).toEqual({});
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const registryPath = join(root, "registry.json");
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const app = createApp({ token: "t", jobs: makeJobs(), registryPath });
    const res = await app.request("/api/registry");
    expect(res.status).toBe(401);
  });
});
