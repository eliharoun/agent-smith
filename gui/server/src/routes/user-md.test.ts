import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "user-md-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const jm = () => new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });

function makeApp() {
  return createApp({
    token: "t",
    jobs: jm(),
    configRoot: root,
    guiStatePath: join(root, "gui-state.json"),
    smithVersion: "0.22.0",
  });
}

const auth = { authorization: "Bearer t", origin: "http://localhost.test" };

describe("user-md route", () => {
  it("GET returns empty content when file does not exist", async () => {
    const app = makeApp();
    const res = await app.request("/api/user-md", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe("");
  });

  it("PUT persists content; subsequent GET reads it back", async () => {
    const app = makeApp();
    const put = await app.request("/api/user-md", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ content: "# hello\n\nuser context" }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/user-md", { headers: auth });
    const body = (await get.json()) as { content: string };
    expect(body.content).toBe("# hello\n\nuser context");
    const onDisk = await readFile(join(root, "USER.md"), "utf8");
    expect(onDisk).toBe("# hello\n\nuser context");
  });

  it("PUT with invalid body returns 400", async () => {
    const app = makeApp();
    const res = await app.request("/api/user-md", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ wrong: "shape" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT rejects content beyond 64KB cap", async () => {
    const app = makeApp();
    const big = "x".repeat(64_001);
    const res = await app.request("/api/user-md", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ content: big }),
    });
    expect(res.status).toBe(400);
  });
});
