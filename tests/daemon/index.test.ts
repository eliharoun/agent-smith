// tests/daemon/index.test.ts
//
// Unit tests for runDaemon (DI seam). Real spawn / signal-handler coverage is
// in tests/daemon/integration.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import type { AgentBundle } from "../../src/core/types";
import { type HeartbeatSnapshot, runDaemon } from "../../src/daemon";
import type { BuildAndInstallOptions } from "../../src/io/orchestrator";
import { waitFor } from "../_helpers/wait-for";
import {
  dirtyPull,
  emptyInstallResult,
  errorPull,
  fakeRegistry,
  fakeSource,
  makeSink,
  okPull,
} from "./fixtures";

describe("runDaemon — DI seam", () => {
  test("returns a handle whose shutdown() resolves cleanly with no tick fired", async () => {
    // Smallest possible exercise of the DI surface: pass every collaborator
    // as a stub, run the daemon long enough to complete its initial reinstall,
    // then shut it down. Asserts:
    //   - DaemonDeps is accepted (TypeScript compile gate).
    //   - runDaemon returns an awaitable handle with a shutdown() method.
    //   - shutdown() clears the interval (otherwise the test process would
    //     hang past the assertion, which `bun test` would surface as a
    //     test-suite-leaks-handle error or a timeout).
    //   - No tick fired in the brief interval before shutdown.
    const sink = makeSink();
    let pullCalls = 0;
    let installCalls = 0;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return emptyInstallResult();
      },
      pullIfClean: async () => {
        pullCalls++;
        return okPull();
      },
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000, // big enough that no tick fires before shutdown
      installProcessHandlers: false,
    });

    expect(handle).toBeDefined();
    expect(typeof handle.shutdown).toBe("function");
    // Initial reinstall ran exactly once.
    expect(installCalls).toBe(1);
    // No tick fired (pullIntervalMs is 60s, we haven't waited).
    expect(pullCalls).toBe(0);

    await handle.shutdown();
    // Shutdown is idempotent.
    await handle.shutdown();
  });
});

describe("runDaemon — single-flight reinstall (DAEMON-6, DAEMON-7)", () => {
  test("concurrent triggers during an in-flight reinstall collapse to one rerun", async () => {
    // Goal: prove that bursting N triggers while a reinstall is mid-flight
    // results in exactly ONE rerun (not N reruns).
    //
    // The initial reinstall is awaited inside runDaemon, so we can't burst
    // "during" it from the outside. Instead, we make the FIRST install fast
    // (initial completes quickly) and the SECOND install slow, and burst
    // the triggers during the second install's window.
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCalls = 0;
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        // Skip slowdown for the initial install so runDaemon returns quickly;
        // make the second install slow enough to burst into.
        if (installCalls >= 2) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    expect(capturedOnChange).not.toBeNull();
    expect(installCalls).toBe(1); // initial completed

    // Fire the second install (slow). Don't await — let it run in the background.
    capturedOnChange!(["/some/source/file.md"]);
    // Give it a microtask to start.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(installCalls).toBe(2); // second install in flight

    // Burst three more triggers while the second install is in flight.
    capturedOnChange!(["/some/source/file.md"]);
    capturedOnChange!(["/some/source/file.md"]);
    capturedOnChange!(["/some/source/file.md"]);

    // Wait long enough for second install + one collapsed rerun to finish.
    await waitFor(() => installCalls === 3, {
      timeoutMs: 2000,
      description: "collapsed reruns complete",
    });

    // Initial (1) + second install (1) + one collapsed rerun (1) = 3.
    // NOT 5 (1 initial + 1 trigger + 3 bursts).
    expect(installCalls).toBe(3);

    await handle.shutdown();
  });

  test("trigger arriving after a reinstall completes runs immediately (no debounce of single events)", async () => {
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCalls = 0;
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    expect(installCalls).toBe(1); // initial

    // Wait for initial to complete, then fire one trigger.
    await new Promise((resolve) => setTimeout(resolve, 10));
    capturedOnChange!(["/some/source/file.md"]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(installCalls).toBe(2); // initial + one trigger

    await handle.shutdown();
  });

  test("logs that a trigger was collapsed when arriving during in-flight work", async () => {
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCalls = 0;
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        if (installCalls >= 2) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    // Start the slow second install.
    capturedOnChange!(["/some/source/file.md"]);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Burst two more triggers mid-flight.
    capturedOnChange!(["/some/source/file.md"]);
    capturedOnChange!(["/some/source/file.md"]);

    await waitFor(
      () => sink.out.some((line) => /collaps|skipped|in.flight|rerun.pending/i.test(line)),
      { timeoutMs: 2000, description: "collapsed trigger log appears" },
    );

    // At least one log line should mention that a trigger was collapsed.
    const collapsedLogs = sink.out.filter((line) =>
      /collaps|skipped|in.flight|rerun.pending/i.test(line),
    );
    expect(collapsedLogs.length).toBeGreaterThan(0);

    await handle.shutdown();
  });
});

describe("runDaemon — per-source state tracking (DAEMON-5)", () => {
  test("getState() returns idle for every git-pullable source before any tick", async () => {
    const sink = makeSink();
    const sources = [
      fakeSource({ label: "alpha", rootPath: "/fake/alpha" }),
      fakeSource({ label: "beta", rootPath: "/fake/beta" }),
    ];

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry(sources),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    const state = handle.getState();
    expect(state.size).toBe(2);
    expect(state.get("alpha")).toBe("idle");
    expect(state.get("beta")).toBe("idle");

    await handle.shutdown();
  });

  test("getState() omits sources that aren't git-pullable", async () => {
    const sink = makeSink();
    const sources = [
      fakeSource({ label: "git-source", gitRemote: "https://example.com/x.git" }),
      // Explicit undefined → not pullable, shouldn't appear in state map.
      fakeSource({ label: "local-only", gitRemote: undefined }),
    ];

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry(sources),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    const state = handle.getState();
    expect(state.has("git-source")).toBe(true);
    expect(state.has("local-only")).toBe(false);

    await handle.shutdown();
  });

  test("dirty pull transitions state to 'dirty', logs once, does NOT trigger reinstall", async () => {
    const sink = makeSink();
    let installCalls = 0;
    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource({ label: "alpha" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return emptyInstallResult();
      },
      pullIfClean: async () => dirtyPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      // Tiny interval so a tick fires; we'll wait ~30ms then assert.
      pullIntervalMs: 10,
      installProcessHandlers: false,
    });

    // Let two ticks fire (20ms+).
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(handle.getState().get("alpha")).toBe("dirty");

    // Initial install (1) only — no reinstall on dirty ticks.
    expect(installCalls).toBe(1);

    // Exactly one "dirty" log line, even though multiple ticks saw dirty.
    const dirtyLogs = sink.out.concat(sink.err).filter((line) => /dirty|uncommitted/i.test(line));
    expect(dirtyLogs.length).toBe(1);

    await handle.shutdown();
  });

  test("error pull transitions state to 'error', logs once, does NOT trigger reinstall", async () => {
    const sink = makeSink();
    let installCalls = 0;
    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource({ label: "alpha" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return emptyInstallResult();
      },
      pullIfClean: async () => errorPull("fatal: cannot reach remote"),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 10,
      installProcessHandlers: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(handle.getState().get("alpha")).toBe("error");
    expect(installCalls).toBe(1); // initial only

    const errorLogs = sink.out
      .concat(sink.err)
      .filter((line) => /pull error|cannot reach remote/i.test(line));
    expect(errorLogs.length).toBe(1);

    await handle.shutdown();
  });

  test("recovery from dirty back to clean logs once and resumes reinstalls", async () => {
    const sink = makeSink();
    let installCalls = 0;
    let pullCalls = 0;
    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource({ label: "alpha" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return emptyInstallResult();
      },
      pullIfClean: async () => {
        pullCalls++;
        // First two ticks: dirty. Third tick onward: clean.
        return pullCalls < 3 ? dirtyPull() : okPull();
      },
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 10,
      installProcessHandlers: false,
    });

    // Wait long enough for ~5 ticks.
    await waitFor(() => installCalls >= 2 && handle.getState().get("alpha") === "idle", {
      timeoutMs: 2000,
      description: "post-recovery reinstall fires and alpha returns to idle",
    });

    // After recovery, state should be back to idle.
    expect(handle.getState().get("alpha")).toBe("idle");

    // Initial install (1) + at least one post-recovery reinstall (>=1).
    expect(installCalls).toBeGreaterThanOrEqual(2);

    // Exactly one dirty-warning log AND exactly one recovery log.
    const dirtyLogs = sink.out.concat(sink.err).filter((line) => /dirty|uncommitted/i.test(line));
    const recoveryLogs = sink.out
      .concat(sink.err)
      .filter((line) => /recovered|resumed|back to clean/i.test(line));
    expect(dirtyLogs.length).toBe(1);
    expect(recoveryLogs.length).toBe(1);

    await handle.shutdown();
  });
});

describe("runDaemon — top-level error handlers (DAEMON-1, DAEMON-8)", () => {
  test("installProcessHandlers:false does NOT register uncaughtException/unhandledRejection listeners", async () => {
    // Belt-and-braces test: confirms the test-side opt-out works so that
    // tests don't pollute the global process handler list. Without this
    // guarantee, every daemon test would leak handlers that could swallow
    // unrelated test failures.
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeUnhandled = process.listenerCount("unhandledRejection");
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
    });

    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);

    await handle.shutdown();
  });

  test("installProcessHandlers:true registers uncaughtException + unhandledRejection listeners and removes them on shutdown", async () => {
    // The handlers must be REMOVED on shutdown — otherwise running the daemon
    // multiple times in a long-lived host process would leak listeners
    // and Node would eventually warn about MaxListenersExceeded.
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeUnhandled = process.listenerCount("unhandledRejection");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const sink = makeSink();

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: true,
    });

    // Each handler family gained at least one listener.
    expect(process.listenerCount("uncaughtException")).toBeGreaterThan(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(beforeUnhandled);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(beforeSigterm);

    await handle.shutdown();

    // Counts back to baseline after shutdown — no listener leak.
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  test("uncaughtException handler logs to errLog and triggers shutdown", async () => {
    // Capture the registered handler, invoke it directly (we can't actually
    // throw uncaught in a test without crashing the test runner), and verify
    // it (a) logs the error and (b) closes the daemon's resources.
    const sink = makeSink();
    let watcherClosed = false;
    let exitCalled = false;
    const fakeExit = (_code?: number): never => {
      exitCalled = true;
      // Don't actually exit — return undefined cast to never so the
      // handler's code-path completes for assertion purposes.
      return undefined as never;
    };

    // Snapshot the pre-existing listeners so we can pick out the one THIS
    // daemon registers, rather than assuming it lands at [length-1]. Other
    // daemon tests in the same process may have registered (and not yet fully
    // removed) handlers, so positional indexing is order-dependent and flakes
    // on CI; a set-difference is robust regardless of execution order.
    const beforeUncaught = new Set(process.listeners("uncaughtException"));

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () =>
        ({
          close: async () => {
            watcherClosed = true;
          },
        }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: true,
      // Inject a fake process.exit so the handler doesn't kill the test runner.
      exit: fakeExit,
    });

    // The handler THIS daemon just added (set-difference, not [length-1]).
    const ourHandler = process
      .listeners("uncaughtException")
      .find((l) => !beforeUncaught.has(l)) as (err: Error) => void;

    // Invoke as if Node had caught a thrown error in async code.
    ourHandler(new Error("boom: test uncaught"));

    // Give the handler's async shutdown a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Logged to errLog with the message visible.
    const errLines = sink.err.filter((l) => /boom: test uncaught/.test(l));
    expect(errLines.length).toBeGreaterThan(0);
    // Watcher.close() was called as part of shutdown.
    expect(watcherClosed).toBe(true);
    // process.exit was called with a non-zero code.
    expect(exitCalled).toBe(true);

    // shutdown() is idempotent — calling it again should be a no-op even
    // though the handler already triggered a shutdown.
    await handle.shutdown();
  });

  test("unhandledRejection handler logs the rejection reason and triggers shutdown", async () => {
    const sink = makeSink();
    let watcherClosed = false;
    let exitCalled = false;

    // Set-difference (not [length-1]) to find THIS daemon's handler — robust
    // against handlers left registered by other daemon tests in the same
    // process, which made positional indexing order-dependent and flaky on CI.
    const beforeUnhandled = new Set(process.listeners("unhandledRejection"));

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () =>
        ({
          close: async () => {
            watcherClosed = true;
          },
        }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: true,
      exit: (_code?: number): never => {
        exitCalled = true;
        return undefined as never;
      },
    });

    const ourHandler = process
      .listeners("unhandledRejection")
      .find((l) => !beforeUnhandled.has(l)) as (reason: unknown) => void;

    ourHandler(new Error("kaboom: test rejection"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const errLines = sink.err.filter((l) => /kaboom: test rejection/.test(l));
    expect(errLines.length).toBeGreaterThan(0);
    expect(watcherClosed).toBe(true);
    expect(exitCalled).toBe(true);

    await handle.shutdown();
  });
});

describe("runDaemon — heartbeat (DAEMON-4, DAEMON-11)", () => {
  test("writes an initial heartbeat snapshot before the daemon returns", async () => {
    // The handle should not be returned to the caller until at least one
    // heartbeat has been written, so `daemonStart` (commit 6) can read the
    // file as proof the child reached steady state. We verify by checking
    // the writer was called at least once before runDaemon resolves.
    const sink = makeSink();
    const writes: HeartbeatSnapshot[] = [];

    const handle = await runDaemon({
      loadRegistry: async () =>
        fakeRegistry([fakeSource({ label: "alpha" }), fakeSource({ label: "beta" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000, // big enough that no tick fires
      writeHeartbeat: async (snap) => {
        writes.push(snap);
      },
    });

    expect(writes.length).toBeGreaterThanOrEqual(1);
    const initial = writes[0]!;
    expect(initial.pid).toBe(process.pid);
    expect(typeof initial.startedAt).toBe("number");
    expect(initial.lastBeatAt).toBe(initial.startedAt); // first beat == start
    expect(initial.sources.alpha).toBe("idle");
    expect(initial.sources.beta).toBe("idle");

    await handle.shutdown();
  });

  test("rewrites the heartbeat on every heartbeatIntervalMs tick with a fresh lastBeatAt", async () => {
    const sink = makeSink();
    const writes: HeartbeatSnapshot[] = [];

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource({ label: "alpha" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 10,
      writeHeartbeat: async (snap) => {
        writes.push(snap);
      },
    });

    // Wait long enough for ~3 ticks beyond the initial.
    await new Promise((resolve) => setTimeout(resolve, 45));

    expect(writes.length).toBeGreaterThanOrEqual(3);
    // lastBeatAt must monotonically increase (or stay equal — but with
    // 10ms ticks a real clock will tick).
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i]!.lastBeatAt).toBeGreaterThanOrEqual(writes[i - 1]!.lastBeatAt);
    }
    // startedAt must NOT change across ticks.
    const startedAt = writes[0]!.startedAt;
    for (const w of writes) expect(w.startedAt).toBe(startedAt);

    await handle.shutdown();
  });

  test("heartbeat snapshot reflects current per-source state", async () => {
    const sink = makeSink();
    const writes: HeartbeatSnapshot[] = [];
    let pullCalls = 0;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource({ label: "alpha" })]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => {
        pullCalls++;
        return pullCalls === 1 ? dirtyPull() : okPull();
      },
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 10, // fire pull tick fast
      installProcessHandlers: false,
      heartbeatIntervalMs: 10,
      writeHeartbeat: async (snap) => {
        writes.push(snap);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    // At some point we should see the snapshot record alpha as "dirty".
    const sawDirty = writes.some((w) => w.sources.alpha === "dirty");
    expect(sawDirty).toBe(true);

    await handle.shutdown();
  });

  test("shutdown invokes removeHeartbeat exactly once (cleanup)", async () => {
    const sink = makeSink();
    let removeCalls = 0;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyInstallResult(),
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {
        removeCalls++;
      },
    });

    await handle.shutdown();
    // Idempotent shutdown: second call should NOT invoke removeHeartbeat again.
    await handle.shutdown();
    expect(removeCalls).toBe(1);
  });
});

describe("runDaemon — self-write suppression (followup #16)", () => {
  test("chokidar event whose paths are all install destinations is dropped", async () => {
    // The daemon installs into /tmp/fake-install/agent.md. chokidar will
    // see that write and fire onChange with that path. Without
    // suppression, the daemon would reinstall, write again, fire again
    // — a feedback loop that produces multiple installs per pull tick.
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    const installCalls = 0;
    const sink = makeSink();
    const installedPath = "/tmp/fake-install/agent.md";

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => ({
        installed: [{ target: "opencode", path: installedPath }],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(installCalls).toBe(0); // we don't increment in fake; track via state below
    // The initial install ran; installedPath is now in the suppression set.
    capturedOnChange!([installedPath]);
    capturedOnChange!([installedPath]);

    // Wait for any reinstalls to settle.
    await new Promise((resolve) => setTimeout(resolve, 30));

    // No further installs triggered by self-write echoes — assert via
    // the log not containing extra "installed" lines beyond the initial.
    const installedLogs = sink.out.filter((line) => /installed/i.test(line));
    expect(installedLogs.length).toBe(1); // initial only

    const dropLogs = sink.out
      .concat(sink.err)
      .filter((line) => /dropped|self-write|echo/i.test(line));
    expect(dropLogs.length).toBeGreaterThan(0);

    await handle.shutdown();
  });

  test("chokidar event with a path outside install destinations triggers reinstall", async () => {
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCalls = 0;
    const sink = makeSink();
    const installedPath = "/tmp/fake-install/agent.md";

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return {
          installed: [{ target: "opencode", path: installedPath }],
          skipped: [],
          warnings: [],
          errors: [],
          grantedKnowledgeDirs: [],
          knowledge: [],
        };
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(installCalls).toBe(1); // initial

    // Real user edit at a source path (NOT inside install destinations).
    capturedOnChange!(["/some/source/path/AGENT.md"]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(installCalls).toBe(2); // initial + real-edit reinstall
    await handle.shutdown();
  });

  test("mixed batch (some install destinations, some real edits) triggers reinstall", async () => {
    // Defensive: if chokidar coalesces a self-write echo and a real user
    // edit into the same callback, we MUST NOT drop the batch — the
    // user edit would be lost. Reinstall on any-outside-path.
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCalls = 0;
    const sink = makeSink();
    const installedPath = "/tmp/fake-install/agent.md";

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCalls++;
        return {
          installed: [{ target: "opencode", path: installedPath }],
          skipped: [],
          warnings: [],
          errors: [],
          grantedKnowledgeDirs: [],
          knowledge: [],
        };
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(installCalls).toBe(1);
    capturedOnChange!([installedPath, "/real/edit.md"]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(installCalls).toBe(2); // mixed → reinstalled
    await handle.shutdown();
  });

  test("install destination set grows across reinstalls (not just initial)", async () => {
    // The first install writes agent-v1.md. A real edit triggers a
    // reinstall that writes agent-v2.md. After that, an event reporting
    // ONLY agent-v2.md should be suppressed (it's now an install dest).
    let capturedOnChange: ((paths: string[]) => void) | null = null;
    let installCallNum = 0;
    const sink = makeSink();
    const path1 = "/tmp/fake-install/agent-v1.md";
    const path2 = "/tmp/fake-install/agent-v2.md";

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => {
        installCallNum++;
        return {
          installed:
            installCallNum === 1
              ? [{ target: "opencode", path: path1 }]
              : [{ target: "opencode", path: path2 }],
          skipped: [],
          warnings: [],
          errors: [],
          grantedKnowledgeDirs: [],
          knowledge: [],
        };
      },
      pullIfClean: async () => okPull(),
      startWatcher: (_paths, opts) => {
        capturedOnChange = opts.onChange;
        return { close: async () => {} } as never;
      },
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(installCallNum).toBe(1);

    // Real edit triggers reinstall #2 which writes path2.
    capturedOnChange!(["/source/edit.md"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(installCallNum).toBe(2);

    // Now self-write echo for path2 should be suppressed.
    capturedOnChange!([path2]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(installCallNum).toBe(2); // not 3

    await handle.shutdown();
  });
});

describe("runDaemon — load failure warnings (partial-failure envelope)", () => {
  test("doReinstall warns load failures via errLog and proceeds with loaded bundles", async () => {
    // The daemon adopted the warn-and-continue policy when migrating to
    // LoadAllBundlesResult: every BundleLoadFailure is warned via errLog,
    // and buildAndInstall is invoked with `result.bundles` (the loaded
    // subset). This test pins both halves.
    const sink = makeSink();
    const goodBundle = {
      config: { name: "good" },
      source: fakeSource(),
      bundlePath: "/fake/source/agents/good",
      files: { identity: "", expertise: "", soul: "", user: "" },
    } as unknown as import("../../src/core/types").AgentBundle;
    const failures = [
      {
        sourceKind: "registered" as const,
        sourceLabel: "fake",
        bundlePath: "/fake/source/agents/bad",
        reason: "boom: invalid frontmatter",
      },
    ];

    let receivedBundles: import("../../src/core/types").AgentBundle[] | null = null;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({
        bundles: [goodBundle],
        failures,
      }),
      buildAndInstall: async (bundles) => {
        receivedBundles = bundles;
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    // buildAndInstall received only the loaded subset (the good bundle).
    expect(receivedBundles).not.toBeNull();
    expect(receivedBundles!.length).toBe(1);
    expect(receivedBundles![0]!.bundlePath).toBe("/fake/source/agents/good");

    // errLog received exactly one warning whose text mentions the failed
    // bundle's source label, path, and reason.
    const warnLines = sink.err.filter((l) => l.includes("warn:"));
    expect(warnLines.length).toBe(1);
    expect(warnLines[0]).toContain("fake");
    expect(warnLines[0]).toContain("/fake/source/agents/bad");
    expect(warnLines[0]).toContain("boom: invalid frontmatter");

    await handle.shutdown();
  });
});

describe("runDaemon — refresh-hook repopulation in doReinstall (PHASE-5 task 0)", () => {
  // Before this fix the daemon called buildAndInstall WITHOUT a
  // `withRefreshHooksFor` map, which made the orchestrator fail-closed
  // default silently strip user-consented SessionStart hooks from every
  // Claude Code agent on every reinstall (initial install, watcher tick,
  // post-pull rerun). These tests pin that the daemon now reconstructs
  // the map from each bundle's on-disk refresh manifest before invoking
  // buildAndInstall.
  //
  // The temp dir is injected via DaemonDeps.defaultAgentSmithHome — the
  // same DI pattern already used for defaultInstallPaths (src/daemon/index.ts).

  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "daemon-refresh-hooks-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function bundleNamed(name: string): AgentBundle {
    return {
      config: { name } as unknown as AgentBundle["config"],
      source: fakeSource(),
      bundlePath: `/fake/agents/${name}`,
      files: { identity: "", expertise: "", soul: "", user: "" },
    };
  }

  test("withRefreshHooksFor is populated from the agent's refresh manifest", async () => {
    // Write a real consent manifest for `alpha` covering claude-code.
    // The daemon should observe this and pass `["alpha", true]` in the
    // map to buildAndInstall.
    await writeRefreshManifest(tmp, "alpha", {
      schemaVersion: 1,
      agent: "alpha",
      refresh_consent: {
        granted_at: "2026-05-18T10:00:00Z",
        platforms: ["claude-code"],
        sources: ["src-a"],
      },
    });

    const sink = makeSink();
    let capturedOptions: BuildAndInstallOptions | undefined;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [bundleNamed("alpha")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        capturedOptions = options;
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      defaultAgentSmithHome: () => tmp,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(capturedOptions).toBeDefined();
    if (!capturedOptions) throw new Error("unreachable: asserted above");
    const map = capturedOptions.withRefreshHooksFor;
    expect(map).toBeInstanceOf(Map);
    if (!map) throw new Error("unreachable: asserted above");
    expect(map.get("alpha")).toBe(true);
    expect(map.size).toBe(1);

    await handle.shutdown();
  });

  test("no manifest on disk → withRefreshHooksFor is an empty map (not undefined)", async () => {
    // Belt-and-braces: even when there's no consent recorded, the
    // daemon must still pass an explicit map so the orchestrator's
    // contract is exercised the same way every call. An empty Map is
    // semantically distinct from `undefined` and pins the fix.
    const sink = makeSink();
    let capturedOptions: BuildAndInstallOptions | undefined;

    const handle = await runDaemon({
      loadRegistry: async () => fakeRegistry([fakeSource()]),
      loadAllBundles: async () => ({ bundles: [bundleNamed("alpha")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        capturedOptions = options;
        return emptyInstallResult();
      },
      pullIfClean: async () => okPull(),
      startWatcher: () => ({ close: async () => {} }) as never,
      defaultInstallPaths: () => ({}) as never,
      defaultAgentSmithHome: () => tmp,
      log: sink.log,
      errLog: sink.errLog,
      pullIntervalMs: 60_000,
      installProcessHandlers: false,
      heartbeatIntervalMs: 60_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
    });

    expect(capturedOptions).toBeDefined();
    if (!capturedOptions) throw new Error("unreachable: asserted above");
    const map = capturedOptions.withRefreshHooksFor;
    expect(map).toBeInstanceOf(Map);
    if (!map) throw new Error("unreachable: asserted above");
    expect(map.size).toBe(0);

    await handle.shutdown();
  });
});

describe("runDaemon — TTL refresh loop", () => {
  // Independent of the 15-min git-pull interval; verifies the dedicated
  // TTL setInterval (PHASE-5 task 3) is scheduled, invokes refreshSource
  // for stale sources, and is cleared on shutdown.

  test("schedules a TTL tick that invokes refreshSource for stale sources", async () => {
    const sink = makeSink();
    const calls: Array<{ agent: string; sourceId: string }> = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "daemon-ttl-"));
    try {
      const handle = await runDaemon({
        loadRegistry: async () => fakeRegistry([fakeSource()]),
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        buildAndInstall: async () => emptyInstallResult(),
        pullIfClean: async () => okPull(),
        startWatcher: () => ({ close: async () => {} }) as never,
        defaultInstallPaths: () => ({}) as never,
        log: sink.log,
        errLog: sink.errLog,
        // Big pull interval so its tick does NOT race; tiny TTL interval so
        // a refresh tick fires within the wait window below.
        pullIntervalMs: 60_000,
        installProcessHandlers: false,
        heartbeatIntervalMs: 60_000,
        writeHeartbeat: async () => {},
        removeHeartbeat: async () => {},
        ttlIntervalMs: 10,
        enumerateTtlAgents: async () => [{ name: "a", sources: [{ id: "s1", ttlMs: 1 }] }],
        refreshSource: async (agent, sourceId) => {
          calls.push({ agent, sourceId });
          return { ok: true };
        },
        // Point cache root at an isolated temp dir so the loop's read/write
        // doesn't touch the user's real ~/.cache or collide with other runs.
        refreshCacheRoot: () => cacheDir,
      });

      // Let at least one TTL tick fire (10ms interval, wait 40ms for headroom).
      await new Promise((resolve) => setTimeout(resolve, 40));
      await handle.shutdown();

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toEqual({ agent: "a", sourceId: "s1" });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("shutdown clears the TTL interval so no further ticks fire", async () => {
    const sink = makeSink();
    let calls = 0;
    const cacheDir = await mkdtemp(join(tmpdir(), "daemon-ttl-shutdown-"));
    try {
      const handle = await runDaemon({
        loadRegistry: async () => fakeRegistry([fakeSource()]),
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        buildAndInstall: async () => emptyInstallResult(),
        pullIfClean: async () => okPull(),
        startWatcher: () => ({ close: async () => {} }) as never,
        defaultInstallPaths: () => ({}) as never,
        log: sink.log,
        errLog: sink.errLog,
        pullIntervalMs: 60_000,
        installProcessHandlers: false,
        heartbeatIntervalMs: 60_000,
        writeHeartbeat: async () => {},
        removeHeartbeat: async () => {},
        ttlIntervalMs: 10,
        enumerateTtlAgents: async () => [{ name: "a", sources: [{ id: "s1", ttlMs: 1 }] }],
        refreshSource: async () => {
          calls++;
          return { ok: true };
        },
        refreshCacheRoot: () => cacheDir,
      });

      // Let a couple of ticks fire.
      await new Promise((resolve) => setTimeout(resolve, 35));
      await handle.shutdown();
      const callsAtShutdown = calls;

      // Wait well past several would-be tick boundaries.
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(calls).toBe(callsAtShutdown);
      expect(callsAtShutdown).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("shutdown awaits the in-flight TTL tick (no calls after shutdown returns)", async () => {
    // Regression: setInterval schedules an async IIFE every tick. clearInterval
    // stops future ticks but does NOT await an IIFE that's already mid-flight
    // (e.g. awaiting a slow refreshSource). Without the fix, shutdown() returns
    // while refreshSource is still pending, allowing cache writes / network IO
    // to leak past daemon shutdown. This test uses a manually-released deferred
    // so the race is deterministic, not timing-dependent.
    const sink = makeSink();
    let calls = 0;
    let completions = 0;
    let release: () => void = () => {};
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "daemon-ttl-await-"));
    try {
      const handle = await runDaemon({
        loadRegistry: async () => fakeRegistry([fakeSource()]),
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        buildAndInstall: async () => emptyInstallResult(),
        pullIfClean: async () => okPull(),
        startWatcher: () => ({ close: async () => {} }) as never,
        defaultInstallPaths: () => ({}) as never,
        log: sink.log,
        errLog: sink.errLog,
        pullIntervalMs: 60_000,
        installProcessHandlers: false,
        heartbeatIntervalMs: 60_000,
        writeHeartbeat: async () => {},
        removeHeartbeat: async () => {},
        ttlIntervalMs: 10,
        enumerateTtlAgents: async () => [{ name: "a", sources: [{ id: "s1", ttlMs: 1 }] }],
        refreshSource: async () => {
          calls++;
          await blocker; // park here until the test calls release()
          completions++;
          return { ok: true };
        },
        refreshCacheRoot: () => cacheDir,
      });

      // Wait long enough for at least one TTL tick to fire and park inside
      // refreshSource. 30ms with a 10ms interval is comfortably past the
      // first tick boundary.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(completions).toBe(0); // refreshSource is parked on `blocker`

      // Kick off shutdown WITHOUT awaiting it. With the fix, this promise
      // will not resolve until release() unblocks the in-flight refreshSource.
      // Without the fix, it resolves immediately because clearInterval doesn't
      // await the IIFE.
      let shutdownReturnedAt = 0;
      const shutdownPromise = handle.shutdown().then(() => {
        shutdownReturnedAt = Date.now();
      });

      // Give shutdown ample time to (incorrectly) return early before we
      // release. 30ms is generous — clearInterval + watcher.close are sync /
      // microtask-fast in this fake setup.
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Snapshot the broken-case observation: without the fix, shutdown has
      // already resolved here and completions is still 0 (refreshSource is
      // still parked).
      const completionsBeforeRelease = completions;

      const releasedAt = Date.now();
      release();
      await shutdownPromise;

      // With the fix: shutdown's resolution was delayed until AFTER release.
      // Without the fix: shutdownReturnedAt was set before releasedAt.
      expect(shutdownReturnedAt).toBeGreaterThanOrEqual(releasedAt);
      // Every tick that started must have completed before shutdown returned.
      expect(completionsBeforeRelease).toBe(0);
      expect(completions).toBe(calls);
    } finally {
      // Defensive: if the test bailed before releasing, unblock now so the
      // daemon can finish and the temp dir can be cleaned.
      release();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("a refreshSource failure is logged but does not crash the daemon", async () => {
    const sink = makeSink();
    const cacheDir = await mkdtemp(join(tmpdir(), "daemon-ttl-fail-"));
    try {
      const handle = await runDaemon({
        loadRegistry: async () => fakeRegistry([fakeSource()]),
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        buildAndInstall: async () => emptyInstallResult(),
        pullIfClean: async () => okPull(),
        startWatcher: () => ({ close: async () => {} }) as never,
        defaultInstallPaths: () => ({}) as never,
        log: sink.log,
        errLog: sink.errLog,
        pullIntervalMs: 60_000,
        installProcessHandlers: false,
        heartbeatIntervalMs: 60_000,
        writeHeartbeat: async () => {},
        removeHeartbeat: async () => {},
        ttlIntervalMs: 10,
        enumerateTtlAgents: async () => [{ name: "a", sources: [{ id: "s1", ttlMs: 1 }] }],
        refreshSource: async () => ({ ok: false, error: "boom" }),
        refreshCacheRoot: () => cacheDir,
      });

      await new Promise((resolve) => setTimeout(resolve, 40));
      await handle.shutdown();

      const errs = sink.err.filter((l) => /refresh error.*boom/.test(l));
      expect(errs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
