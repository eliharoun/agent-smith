import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPendingOps,
  listPendingOps,
  recordPendingOp,
  type PendingOp,
} from "../../src/io/pending-ops";

let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "smith-pending-"));
});
afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

describe("recordPendingOp", () => {
  it("writes a JSON file under <stateRoot>/pending/<command>/<agent>/<platform>.json", async () => {
    const op: PendingOp = {
      schemaVersion: 1,
      agent: "agg-layer-expert",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode", "claude-code"],
    };
    await recordPendingOp(stateRoot, op);
    const path = join(stateRoot, "pending", "agent.install", "agg-layer-expert", "opencode.json");
    const contents = JSON.parse(await readFile(path, "utf8"));
    expect(contents.agent).toBe("agg-layer-expert");
    expect(contents.platform).toBe("opencode");
    expect(contents.schemaVersion).toBe(1);
  });

  it("is idempotent: re-recording overwrites", async () => {
    const op: PendingOp = {
      schemaVersion: 1,
      agent: "x",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode"],
    };
    await recordPendingOp(stateRoot, op);
    await recordPendingOp(stateRoot, { ...op, queuedAt: "2026-06-04T11:00:00Z" });
    const ops = await listPendingOps(stateRoot);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.queuedAt).toBe("2026-06-04T11:00:00Z");
  });
});

describe("listPendingOps", () => {
  it("returns empty array when pending dir is missing", async () => {
    expect(await listPendingOps(stateRoot)).toEqual([]);
  });

  it("returns all ops across commands/agents/platforms", async () => {
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode"],
    });
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "b",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    const ops = await listPendingOps(stateRoot);
    expect(ops).toHaveLength(2);
    const agents = ops.map((o) => o.agent).sort();
    expect(agents).toEqual(["a", "b"]);
  });

  it("filters by platform when requested", async () => {
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode"],
    });
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "b",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    const ops = await listPendingOps(stateRoot, { platform: "opencode" });
    expect(ops).toHaveLength(1);
    expect(ops[0]?.agent).toBe("a");
  });

  it("skips malformed JSON files silently", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(stateRoot, "pending", "agent.install", "x"), { recursive: true });
    await writeFile(
      join(stateRoot, "pending", "agent.install", "x", "opencode.json"),
      "{ not valid json",
    );
    const ops = await listPendingOps(stateRoot);
    expect(ops).toEqual([]);
  });
});

describe("clearPendingOps", () => {
  it("removes by platform", async () => {
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode"],
    });
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "b",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    await clearPendingOps(stateRoot, { platform: "opencode" });
    const ops = await listPendingOps(stateRoot);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.platform).toBe("codex");
  });

  it("removes by agent", async () => {
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "opencode",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["opencode"],
    });
    await recordPendingOp(stateRoot, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    await clearPendingOps(stateRoot, { agent: "a" });
    const ops = await listPendingOps(stateRoot);
    expect(ops).toEqual([]);
  });

  it("no-ops when pending dir doesn't exist", async () => {
    await clearPendingOps(stateRoot, { platform: "opencode" });
    expect(await stat(stateRoot)).toBeDefined();
  });
});
