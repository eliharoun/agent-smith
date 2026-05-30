import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
// TEST-ONLY import: assert parity with the CLI's source-of-truth roots.
// Not a runtime coupling; this test fails CI if the GUI's mirrored layout
// drifts from `src/cli/install-paths.ts` or `src/io/installer.ts:31-39`.
import { defaultInstallPaths as cliDefaultInstallPaths } from "../../../../src/cli/install-paths";
import { computeInstalledStatus, defaultInstallPaths } from "./installed-status";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "install-status-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(p: string): Promise<void> {
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, "");
}

function pathsUnder(
  r: string,
  agent: string,
): Record<"opencode" | "claude-code" | "codex", string> {
  return {
    opencode: join(r, "opencode", `${agent}.md`),
    "claude-code": join(r, "claude", `${agent}.md`),
    codex: join(r, "codex", agent, "SKILL.md"),
  };
}

describe("computeInstalledStatus", () => {
  it("reports all true when every CLI artifact exists", async () => {
    const paths = pathsUnder(root, "foo");
    await touch(paths.opencode);
    await touch(paths["claude-code"]);
    await touch(paths.codex);
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed).toEqual({
      opencode: true,
      "claude-code": true,
      codex: true,
    });
  });

  it("reports false for a missing opencode artifact, true for the others", async () => {
    const paths = pathsUnder(root, "foo");
    await touch(paths["claude-code"]);
    await touch(paths.codex);
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.opencode).toBe(false);
    expect(status.installed["claude-code"]).toBe(true);
    expect(status.installed.codex).toBe(true);
  });

  it("does NOT count a dangling codex directory without SKILL.md as installed", async () => {
    const paths = pathsUnder(root, "foo");
    // Create the per-agent codex dir but omit SKILL.md — this is the bug
    // semantics the new probe locks in: dangling dirs are not installs.
    await mkdir(join(root, "codex", "foo"), { recursive: true });
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.codex).toBe(false);
  });

  it("reports all false when no install artifacts exist", async () => {
    const paths = pathsUnder(root, "foo");
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed).toEqual({
      opencode: false,
      "claude-code": false,
      codex: false,
    });
  });

  it("does NOT count a directory at the artifact path as installed", async () => {
    // Locks in the existing comment's claim: non-file entries must NOT count.
    // `Bun.file().exists()` is platform-dependent for dirs; lstat-based probe
    // makes this deterministic.
    const paths = pathsUnder(root, "foo");
    mkdirSync(join(root, "opencode"), { recursive: true });
    mkdirSync(paths.opencode); // a directory exactly where the file would be
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.opencode).toBe(false);
  });

  it("counts a symlink to an existing file as installed", async () => {
    if (process.platform === "win32") return;
    const paths = pathsUnder(root, "foo");
    const realFile = join(root, "real-target.md");
    writeFileSync(realFile, "hello");
    mkdirSync(join(root, "opencode"), { recursive: true });
    symlinkSync(realFile, paths.opencode);
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.opencode).toBe(true);
  });

  it("does NOT count a symlink to a directory as installed", async () => {
    if (process.platform === "win32") return;
    const paths = pathsUnder(root, "foo");
    const realDir = join(root, "real-dir");
    mkdirSync(realDir);
    mkdirSync(join(root, "opencode"), { recursive: true });
    symlinkSync(realDir, paths.opencode);
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.opencode).toBe(false);
  });

  it("does NOT count a dangling symlink as installed", async () => {
    if (process.platform === "win32") return;
    const paths = pathsUnder(root, "foo");
    mkdirSync(join(root, "opencode"), { recursive: true });
    symlinkSync(join(root, "does-not-exist"), paths.opencode);
    const status = await computeInstalledStatus({ agent: "foo", paths });
    expect(status.installed.opencode).toBe(false);
  });

  it("reports false AND warns when parent directory is unreadable (EACCES)", async () => {
    if (process.platform === "win32") return;
    // Running as root bypasses chmod permissions — skip in that case.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const paths = pathsUnder(root, "foo");
    const parent = join(root, "opencode");
    mkdirSync(parent, { recursive: true });
    writeFileSync(paths.opencode, "");
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    chmodSync(parent, 0o000);
    try {
      const status = await computeInstalledStatus({ agent: "foo", paths });
      expect(status.installed.opencode).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      chmodSync(parent, 0o755); // restore so afterEach rm() can clean up
      warnSpy.mockRestore();
    }
  });
});

describe("defaultInstallPaths CLI parity", () => {
  it("produces per-agent paths anchored at the CLI's per-platform roots", () => {
    const cliRoots = cliDefaultInstallPaths();
    const guiPaths = defaultInstallPaths("alpha");
    expect(guiPaths.opencode).toBe(join(cliRoots.opencode, "alpha.md"));
    expect(guiPaths["claude-code"]).toBe(join(cliRoots["claude-code"], "alpha.md"));
    expect(guiPaths.codex).toBe(join(cliRoots.codex, "alpha", "SKILL.md"));
  });

  it("anchors at the user's homedir (sanity)", () => {
    const home = homedir();
    const p = defaultInstallPaths("beta");
    expect(p.opencode.startsWith(home)).toBe(true);
    expect(p["claude-code"].startsWith(home)).toBe(true);
    expect(p.codex.startsWith(home)).toBe(true);
  });
});
