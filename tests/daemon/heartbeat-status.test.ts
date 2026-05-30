// tests/daemon/heartbeat-status.test.ts
//
// D.1: HeartbeatSnapshot schema v2 — status field.
// D.4: Initial-install watchdog (30s log).

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeartbeatSnapshot } from "../../src/daemon";
import { runDaemon } from "../../src/daemon";
import { defaultWriteHeartbeat, readHeartbeatFromPath } from "../../src/daemon/heartbeat";
import { emptyInstallResult, fakeRegistry, fakeSource, makeSink } from "./fixtures";

describe("HeartbeatSnapshot status field [D.1]", () => {
  test("schema v1 backward-compat: missing status defaults to 'ready'", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smith-hb-status-v1-"));
    try {
      const path = join(dir, "daemon.heartbeat.json");
      // v1 file: no schemaVersion, no status
      await Bun.write(path, JSON.stringify({ pid: 42, startedAt: 1, lastBeatAt: 2, sources: {} }));
      const read = await readHeartbeatFromPath(path);
      expect(read).not.toBeNull();
      expect(read!.status).toBe("ready");
      expect(read!.schemaVersion).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("schema v2 read/write roundtrip preserves status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smith-hb-status-v2-"));
    const original = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = dir;
    try {
      const snap: HeartbeatSnapshot = {
        schemaVersion: 2,
        pid: 99,
        startedAt: 100,
        lastBeatAt: 200,
        status: "installing",
        sources: {},
      };
      await defaultWriteHeartbeat(snap);
      const read = await readHeartbeatFromPath(join(dir, "agent-smith", "daemon.heartbeat.json"));
      expect(read).not.toBeNull();
      expect(read!.schemaVersion).toBe(2);
      expect(read!.status).toBe("installing");
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("status='installing' during initial reinstall, then 'ready' after", async () => {
    let releaseInstall: () => void = () => {};
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });

    let firstWriteResolve: () => void = () => {};
    const firstWrite = new Promise<void>((r) => {
      firstWriteResolve = r;
    });

    const writes: HeartbeatSnapshot[] = [];
    const sink = makeSink();

    const daemonPromise = runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        await installGate;
        return emptyInstallResult();
      },
      pullIfClean: async () => ({ status: "clean" as const, output: "" }),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      writeHeartbeat: async (snap) => {
        writes.push({ ...snap });
        firstWriteResolve();
      },
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 600_000,
      heartbeatIntervalMs: 600_000,
      installProcessHandlers: false,
    });

    // Deterministic: wait for the first heartbeat write (no setTimeout race)
    await firstWrite;
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0]!.status).toBe("installing");

    releaseInstall();
    const handle = await daemonPromise;

    // After install completes, the last write before shutdown should be "ready"
    const readyWrites = writes.filter((w) => w.status === "ready");
    expect(readyWrites.length).toBeGreaterThanOrEqual(1);

    await handle.shutdown();
  });

  test("status='degraded' after initial reinstall throws", async () => {
    const writes: HeartbeatSnapshot[] = [];
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => {
        throw new Error("simulated install failure");
      },
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => ({ status: "clean" as const, output: "" }),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      writeHeartbeat: async (snap) => {
        writes.push({ ...snap });
      },
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 600_000,
      heartbeatIntervalMs: 600_000,
      installProcessHandlers: false,
    });

    // After failed install, should have a degraded heartbeat
    const degradedWrites = writes.filter((w) => w.status === "degraded");
    expect(degradedWrites.length).toBeGreaterThanOrEqual(1);

    await handle.shutdown();
  });
});

describe("Initial-install watchdog [D.4]", () => {
  test("no watchdog log for fast installs (<30s)", async () => {
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return emptyInstallResult();
      },
      pullIfClean: async () => ({ status: "clean" as const, output: "" }),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 600_000,
      heartbeatIntervalMs: 600_000,
      installProcessHandlers: false,
    });

    expect(sink.out.some((l) => /initial install still running/i.test(l))).toBe(false);
    await handle.shutdown();
  });
});
