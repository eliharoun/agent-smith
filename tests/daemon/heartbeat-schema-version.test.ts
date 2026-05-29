// tests/daemon/heartbeat-schema-version.test.ts
//
// B11.4 (v1-task): daemon.heartbeat.json gains a `schemaVersion: 1`
// field. Greenfield — no pre-existing version field. Writers emit it;
// readers tolerate legacy snapshots (missing field).

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeartbeatSnapshot } from "../../src/daemon";
import { defaultWriteHeartbeat, readHeartbeatFromPath } from "../../src/daemon/heartbeat";

describe("HeartbeatSnapshot schemaVersion [v1-task B11.4]", () => {
  test("HeartbeatSnapshot includes schemaVersion: 1 as first field", () => {
    const sample: HeartbeatSnapshot = {
      schemaVersion: 1,
      pid: 1,
      startedAt: 0,
      lastBeatAt: 0,
      sources: {},
    };
    expect(sample.schemaVersion).toBe(1);
  });

  test("defaultWriteHeartbeat then readHeartbeatFromPath round-trips schemaVersion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smith-hb-sv-"));
    const original = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = dir;
    try {
      const snap: HeartbeatSnapshot = {
        schemaVersion: 1,
        pid: 99,
        startedAt: 100,
        lastBeatAt: 200,
        sources: {},
      };
      await defaultWriteHeartbeat(snap);
      const read = await readHeartbeatFromPath(join(dir, "agent-smith", "daemon.heartbeat.json"));
      expect(read?.schemaVersion).toBe(1);
      expect(read?.pid).toBe(99);
      // Writer emits schemaVersion as first field.
      const raw = await Bun.file(join(dir, "agent-smith", "daemon.heartbeat.json")).json();
      expect(raw.schemaVersion).toBe(1);
    } finally {
      if (original === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = original;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readHeartbeatFromPath tolerates legacy file with no schemaVersion (injects 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smith-hb-sv-legacy-"));
    try {
      const path = join(dir, "daemon.heartbeat.json");
      await Bun.write(
        path,
        JSON.stringify({
          pid: 42,
          startedAt: 1,
          lastBeatAt: 2,
          sources: {},
        }),
      );
      const read = await readHeartbeatFromPath(path);
      expect(read?.schemaVersion).toBe(1);
      expect(read?.pid).toBe(42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readHeartbeatFromPath returns null when file missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smith-hb-sv-missing-"));
    try {
      const read = await readHeartbeatFromPath(join(dir, "daemon.heartbeat.json"));
      expect(read).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
