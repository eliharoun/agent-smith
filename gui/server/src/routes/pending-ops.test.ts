import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { registerPendingOpsRoute } from "./pending-ops";
import type { PendingOp } from "../../../../src/io/pending-ops";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pending-ops-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writePendingOp(stateRoot: string, op: PendingOp): Promise<void> {
  const dir = join(stateRoot, "pending", op.command, op.agent);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${op.platform}.json`), JSON.stringify(op));
}

function makeApp(stateRoot: string) {
  const app = new Hono();
  registerPendingOpsRoute(app, { stateRoot });
  return app;
}

describe("GET /api/pending-ops", () => {
  it("returns empty ops when pending dir is absent", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/pending-ops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ops: PendingOp[] };
    expect(body.ops).toEqual([]);
  });

  it("returns all pending ops when records exist", async () => {
    const op: PendingOp = {
      schemaVersion: 1,
      agent: "foo",
      command: "agent.install",
      platform: "claude-code",
      queuedAt: "2026-06-05T00:00:00Z",
      manifestTargetAtQueue: ["claude-code"],
    };
    await writePendingOp(tmpDir, op);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/pending-ops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ops: PendingOp[] };
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]).toMatchObject({
      agent: "foo",
      command: "agent.install",
      platform: "claude-code",
    });
  });

  it("silently skips malformed op files", async () => {
    const dir = join(tmpDir, "pending", "agent.install", "foo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "claude-code.json"), "not-json");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/pending-ops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ops: PendingOp[] };
    expect(body.ops).toEqual([]);
  });
});
