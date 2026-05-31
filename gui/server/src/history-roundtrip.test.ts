import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { createGuiJobManager } from "./index";
import type { Spawner } from "./jobs/job-manager";

const TOKEN = "test-token";
const ORIGIN = "http://localhost.test"; // createApp's default allowedOrigin

const fakeSpawner: Spawner = (_argv, h) => {
  h.onStdout("status output line\n");
  h.onExit(0);
  return { stop: () => {}, writeStdin: () => {} };
};

let stateRoot: string;
beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "gui-roundtrip-"));
});
afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

describe("job -> history round-trip", () => {
  it("a job started via POST /api/jobs is served by GET /api/history", async () => {
    const jobs = createGuiJobManager({ spawner: fakeSpawner, stateRoot });
    const app = createApp({ token: TOKEN, jobs, stateDir: stateRoot });

    const post = await app.request("/api/jobs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ command: "status" }),
    });
    expect(post.status).toBe(202);
    const { jobId } = (await post.json()) as { jobId: string };

    await jobs.waitForExit(jobId);

    let entries: Array<{ id: string; command: string }> = [];
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const res = await app.request("/api/history", {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      entries = (await res.json()) as typeof entries;
      if (entries.length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(entries.map((e) => e.id)).toContain(jobId);
    expect(entries.find((e) => e.id === jobId)?.command).toBe("status");
  });
});
