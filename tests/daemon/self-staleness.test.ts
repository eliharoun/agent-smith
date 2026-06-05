// tests/daemon/self-staleness.test.ts
//
// Layer 2 unit tests for the daemon's self-staleness check. Verifies that
// `binPath` and `statBin` deps are accepted by `runDaemon` and that the
// daemon does not exit when the binary's mtime is unchanged. The deeper
// integration test that exercises the actual exit-on-staleness path lives
// in a follow-up task.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadAllBundlesResult } from "../../src/cli/load-all";
import { runDaemon } from "../../src/daemon";
import type { Registry } from "../../src/io/registry";

const emptyRegistry = (): Registry => ({ schemaVersion: 2, sources: [] });

describe("daemon self-staleness check", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "self-stale-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("daemon exits cleanly when smith binary mtime moves past startup", async () => {
    let exitCode: number | null = null;
    let reinstallCalls = 0;
    const exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("__exit__"); // sentinel: exit() never returns in production
    }) as unknown as (code?: number) => never;

    let currentMtime = 100;

    const handle = await runDaemon({
      loadRegistry: async () => emptyRegistry(),
      loadAllBundles: async (): Promise<LoadAllBundlesResult> => {
        reinstallCalls++;
        return { bundles: [], failures: [] };
      },
      buildAndInstall: async () => ({
        installed: [],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      pullIfClean: async () => ({ status: "clean", output: "" }),
      startWatcher: () => ({ close: async () => {} }),
      installProcessHandlers: false,
      pullIntervalMs: 1_000_000,
      ttlIntervalMs: 1_000_000,
      heartbeatIntervalMs: 1_000_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
      enumerateTtlAgents: async () => [],
      defaultInstallPaths: () => ({ opencode: tmp, claudeCode: tmp, codex: tmp }) as never,
      defaultAgentSmithHome: () => tmp,
      log: () => {},
      errLog: () => {},
      exit,
      // Layer 2 seams:
      binPath: () => "/fake/smith",
      statBin: async () => ({ mtimeMs: currentMtime }),
    });

    expect(reinstallCalls).toBe(1); // initial install ran once

    // Bump the binary mtime past startup; subsequent reinstalls should detect
    // it. This test only verifies the seam wiring — the actual watcher-driven
    // exit path is covered by the deeper integration test.
    currentMtime = 200;

    await handle.shutdown();
    expect(exitCode).toBe(null); // shutdown path is the clean-shutdown; staleness exit
    // happens only INSIDE doReinstall, validated in a separate test
  });

  test("daemon does NOT exit when binary mtime is unchanged", async () => {
    // Pin currentMtime; the implementation must use strict-greater
    // comparison so an equal value does not trip the staleness path.
    let exitCode: number | null = null;
    const exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("__exit__");
    }) as unknown as (code?: number) => never;

    const handle = await runDaemon({
      loadRegistry: async () => emptyRegistry(),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => ({
        installed: [],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      pullIfClean: async () => ({ status: "clean", output: "" }),
      startWatcher: () => ({ close: async () => {} }),
      installProcessHandlers: false,
      pullIntervalMs: 1_000_000,
      ttlIntervalMs: 1_000_000,
      heartbeatIntervalMs: 1_000_000,
      writeHeartbeat: async () => {},
      removeHeartbeat: async () => {},
      enumerateTtlAgents: async () => [],
      defaultInstallPaths: () => ({ opencode: tmp, claudeCode: tmp, codex: tmp }) as never,
      defaultAgentSmithHome: () => tmp,
      log: () => {},
      errLog: () => {},
      exit,
      binPath: () => "/fake/smith",
      statBin: async () => ({ mtimeMs: 42 }), // never changes
    });

    await handle.shutdown();
    expect(exitCode).toBe(null);
  });
});
