// tests/daemon/heartbeat-before-initial-install.test.ts
//
// Regression tests for Appendix C fix: heartbeat must be written BEFORE the
// initial reinstall so daemonStart's 10s poll sees "alive" even when install
// takes 40+ seconds (Confluence pages, large URL fetches, slow git mirrors).

import { describe, expect, test } from "bun:test";
import { type HeartbeatSnapshot, runDaemon } from "../../src/daemon";
import { emptyInstallResult, fakeRegistry, fakeSource, makeSink } from "./fixtures";

describe("heartbeat before initial install (Appendix C)", () => {
  test("writes heartbeat before awaiting initial buildAndInstall", async () => {
    // Manually-resolvable gate: buildAndInstall blocks until we resolve it.
    let releaseInstall: () => void = () => {};
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });

    const writes: HeartbeatSnapshot[] = [];
    const buildAndInstallCalls: number[] = [];
    const sink = makeSink();

    // Do NOT await runDaemon — it would block on the gate.
    const daemonPromise = runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        buildAndInstallCalls.push(Date.now());
        await installGate;
        return emptyInstallResult();
      },
      pullIfClean: async () => ({ status: "clean" as const, output: "" }),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      writeHeartbeat: async (snap) => {
        writes.push(snap);
      },
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 600_000,
      heartbeatIntervalMs: 600_000,
      installProcessHandlers: false,
    });

    // Wait until buildAndInstall has been entered (proving install is in flight).
    for (let i = 0; i < 50 && buildAndInstallCalls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(buildAndInstallCalls.length).toBe(1);

    // The heartbeat must already have been written BEFORE install started.
    // RED on unmodified code (writes.length === 0); GREEN post-fix.
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0]?.pid).toBe(process.pid);

    // Cleanup: release the gate, await runDaemon, shutdown.
    releaseInstall();
    const handle = await daemonPromise;
    await handle.shutdown();
  });

  test("runDaemon resolves only after initial buildAndInstall completes", async () => {
    let installCompletedAt: number | null = null;
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        await new Promise((r) => setTimeout(r, 50));
        installCompletedAt = Date.now();
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

    const resolvedAt = Date.now();
    expect(installCompletedAt).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeNull above
    expect(resolvedAt).toBeGreaterThanOrEqual(installCompletedAt!);
    await handle.shutdown();
  });
});
