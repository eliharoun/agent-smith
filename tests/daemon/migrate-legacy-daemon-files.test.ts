import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyDaemonFiles } from "../../src/cli/commands/daemon";

describe("migrateLegacyDaemonFiles", () => {
  let sandbox: string;
  let originalConfigHome: string | undefined;
  let originalStateHome: string | undefined;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "smith-migrate-"));
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_CONFIG_HOME = join(sandbox, "cfg");
    process.env.XDG_STATE_HOME = join(sandbox, "state");
    await mkdir(join(sandbox, "cfg", "agent-smith"), { recursive: true });
  });

  afterEach(async () => {
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalStateHome;
    await rm(sandbox, { recursive: true, force: true });
  });

  test("moves legacy daemon.pid from config root to state root", async () => {
    const legacyPid = join(sandbox, "cfg", "agent-smith", "daemon.pid");
    await Bun.write(legacyPid, "123456");

    await migrateLegacyDaemonFiles();

    const newPid = join(sandbox, "state", "agent-smith", "daemon.pid");
    expect(await Bun.file(newPid).text()).toBe("123456");
    expect(await Bun.file(legacyPid).exists()).toBe(false);
  });

  test("does not overwrite existing state-root file (no-op when both exist)", async () => {
    const legacyPid = join(sandbox, "cfg", "agent-smith", "daemon.pid");
    const newPid = join(sandbox, "state", "agent-smith", "daemon.pid");
    await Bun.write(legacyPid, "old-legacy");
    await mkdir(join(sandbox, "state", "agent-smith"), { recursive: true });
    await Bun.write(newPid, "current-new");

    await migrateLegacyDaemonFiles();

    expect(await Bun.file(newPid).text()).toBe("current-new");
    // Legacy file is left in place (not deleted) since we didn't move it
    expect(await Bun.file(legacyPid).exists()).toBe(true);
  });
});
