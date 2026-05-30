import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultStateRoot } from "../../gui/server/src/services/cache-paths";
import { runtimeStateHome } from "../../src/io/runtime-state-home";

describe("state-root contract: CLI and GUI agree on daemon file location", () => {
  let sandbox: string;
  let originalStateHome: string | undefined;
  let originalConfigHome: string | undefined;
  let originalCacheHome: string | undefined;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "smith-contract-"));
    originalStateHome = process.env.XDG_STATE_HOME;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_STATE_HOME = join(sandbox, "state");
    process.env.XDG_CONFIG_HOME = join(sandbox, "cfg");
    process.env.XDG_CACHE_HOME = join(sandbox, "cache");
  });

  afterEach(async () => {
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalStateHome;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalCacheHome;
    await rm(sandbox, { recursive: true, force: true });
  });

  test("runtimeStateHome() and defaultStateRoot() resolve to the same path", () => {
    expect(runtimeStateHome()).toBe(defaultStateRoot());
  });

  test("both resolve correctly with XDG_STATE_HOME set", () => {
    process.env.XDG_STATE_HOME = "/custom/state";
    expect(runtimeStateHome()).toBe("/custom/state/agent-smith");
    expect(defaultStateRoot()).toBe("/custom/state/agent-smith");
  });

  test("both fall back identically when XDG_STATE_HOME is unset", () => {
    delete process.env.XDG_STATE_HOME;
    expect(runtimeStateHome()).toBe(defaultStateRoot());
  });

  test("readDaemonStatus sees pid written by CLI path helpers", async () => {
    const { readDaemonStatus } = await import("../../gui/server/src/services/daemon-status");
    const stateDir = runtimeStateHome();
    await mkdir(stateDir, { recursive: true });

    // Simulate CLI writing a pid file
    const fakePid = process.pid; // use our own pid so isAlive returns true
    await Bun.write(join(stateDir, "daemon.pid"), String(fakePid));
    await Bun.write(
      join(stateDir, "daemon.heartbeat.json"),
      JSON.stringify({ pid: fakePid, lastBeatAt: Date.now(), sources: {} }),
    );

    const status = await readDaemonStatus({
      pidPath: join(defaultStateRoot(), "daemon.pid"),
      heartbeatPath: join(defaultStateRoot(), "daemon.heartbeat.json"),
    });

    expect(status.state).toBe("running");
  });
});
