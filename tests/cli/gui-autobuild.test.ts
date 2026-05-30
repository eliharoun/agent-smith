import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeRebuildGuiBundle } from "../../src/cli/commands/gui";

function makeFixture(): { repoRoot: string; distRoot: string; srcRoot: string } {
  const repoRoot = join(
    tmpdir(),
    `smith-gui-autobuild-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const distRoot = join(repoRoot, "gui", "web", "dist");
  const srcRoot = join(repoRoot, "gui", "web", "src");
  mkdirSync(distRoot, { recursive: true });
  mkdirSync(srcRoot, { recursive: true });
  return { repoRoot, distRoot, srcRoot };
}

function setMtime(path: string, epochSeconds: number): void {
  utimesSync(path, epochSeconds, epochSeconds);
}

describe("maybeRebuildGuiBundle", () => {
  let repoRoot = "";
  let distRoot = "";
  let srcRoot = "";
  const originalEnv = process.env.SMITH_GUI_NO_AUTOBUILD;

  beforeEach(() => {
    const f = makeFixture();
    repoRoot = f.repoRoot;
    distRoot = f.distRoot;
    srcRoot = f.srcRoot;
    delete process.env.SMITH_GUI_NO_AUTOBUILD;
  });

  afterEach(() => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (originalEnv === undefined) {
      delete process.env.SMITH_GUI_NO_AUTOBUILD;
    } else {
      process.env.SMITH_GUI_NO_AUTOBUILD = originalEnv;
    }
  });

  it("skips when SMITH_GUI_NO_AUTOBUILD=1", async () => {
    // Stale dist (older than src)
    writeFileSync(join(srcRoot, "App.tsx"), "x");
    writeFileSync(join(distRoot, "index.html"), "y");
    setMtime(join(distRoot, "index.html"), 1000);
    setMtime(join(srcRoot, "App.tsx"), 2000);

    process.env.SMITH_GUI_NO_AUTOBUILD = "1";
    let called = false;
    const log: string[] = [];
    await maybeRebuildGuiBundle({
      repoRoot,
      runBuild: async () => {
        called = true;
      },
      log: (s) => log.push(s),
    });
    expect(called).toBe(false);
  });

  it("skips when srcRoot is missing (packaged install)", async () => {
    rmSync(srcRoot, { recursive: true, force: true });
    writeFileSync(join(distRoot, "index.html"), "y");

    let called = false;
    await maybeRebuildGuiBundle({
      repoRoot,
      runBuild: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });

  it("runs build when distMtime < newestSrcMtime", async () => {
    writeFileSync(join(distRoot, "index.html"), "y");
    writeFileSync(join(srcRoot, "App.tsx"), "x");
    setMtime(join(distRoot, "index.html"), 1000);
    setMtime(join(srcRoot, "App.tsx"), 2000);

    let called = false;
    let receivedCwd = "";
    await maybeRebuildGuiBundle({
      repoRoot,
      runBuild: async (cwd) => {
        called = true;
        receivedCwd = cwd;
      },
    });
    expect(called).toBe(true);
    expect(receivedCwd).toBe(repoRoot);
  });

  it("runs build when distRoot is missing entirely", async () => {
    rmSync(distRoot, { recursive: true, force: true });
    writeFileSync(join(srcRoot, "App.tsx"), "x");

    let called = false;
    await maybeRebuildGuiBundle({
      repoRoot,
      runBuild: async () => {
        called = true;
      },
    });
    expect(called).toBe(true);
  });

  it("no-op when dist is fresh", async () => {
    writeFileSync(join(srcRoot, "App.tsx"), "x");
    writeFileSync(join(distRoot, "index.html"), "y");
    setMtime(join(srcRoot, "App.tsx"), 1000);
    setMtime(join(distRoot, "index.html"), 2000);

    let called = false;
    await maybeRebuildGuiBundle({
      repoRoot,
      runBuild: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });

  it("surfaces actionable error message on build failure", async () => {
    writeFileSync(join(srcRoot, "App.tsx"), "x");
    writeFileSync(join(distRoot, "index.html"), "y");
    setMtime(join(distRoot, "index.html"), 1000);
    setMtime(join(srcRoot, "App.tsx"), 2000);

    await expect(
      maybeRebuildGuiBundle({
        repoRoot,
        runBuild: async () => {
          throw new Error("exit 1");
        },
      }),
    ).rejects.toThrow(/bun run gui:build/);
  });
});
