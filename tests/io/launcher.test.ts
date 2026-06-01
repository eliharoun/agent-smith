import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLauncherBody, writeLauncher } from "../../src/io/launcher";

/**
 * Hermetic launcher-write tests. Every fixture is rooted in a `mkdtemp`
 * tmpdir; nothing touches the user's real `$HOME` or `~/.local/bin/smith`.
 * The `launcherPath` and `resolveBun` injection seams keep the production
 * defaults (which DO touch real `$HOME`) out of the test path.
 */

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "smith-launcher-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function makeFakeWorkspace(): Promise<string> {
  const ws = join(tmpRoot, "ws");
  await mkdir(join(ws, "src"), { recursive: true });
  // Empty src/index.ts is enough — the launcher only needs the path to
  // exist for realpath() to succeed.
  await writeFile(join(ws, "src", "index.ts"), "// fixture\n", "utf8");
  return ws;
}

async function makeFakeBun(): Promise<string> {
  const bunPath = join(tmpRoot, "bun");
  await writeFile(bunPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(bunPath, 0o755);
  return bunPath;
}

describe("buildLauncherBody", () => {
  it("emits the canonical wrapper shape with both paths interpolated", () => {
    const body = buildLauncherBody("/abs/bun", "/abs/repo/src/index.ts");
    expect(body.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(body).toContain('exec "/abs/bun" "/abs/repo/src/index.ts" "$@"');
    expect(body.endsWith("\n")).toBe(true);
  });

  it("is byte-stable across calls with identical inputs", () => {
    const a = buildLauncherBody("/x", "/y");
    const b = buildLauncherBody("/x", "/y");
    expect(a).toBe(b);
  });
});

describe("writeLauncher", () => {
  it("writes a regular executable file with the expected exec line", async () => {
    const ws = await makeFakeWorkspace();
    const bunPath = await makeFakeBun();
    const launcherPath = join(tmpRoot, "out", "smith");

    const result = await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => bunPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stat = await lstat(launcherPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o111).not.toBe(0); // some executable bit set
    const body = await readFile(launcherPath, "utf8");
    expect(body).toContain(`exec "${result.bunPath}" "${result.entryPath}" "$@"`);
  });

  it("replaces a pre-existing symlink (transition from legacy layout)", async () => {
    const ws = await makeFakeWorkspace();
    const bunPath = await makeFakeBun();
    const launcherDir = join(tmpRoot, "out");
    await mkdir(launcherDir, { recursive: true });
    const launcherPath = join(launcherDir, "smith");
    // Pre-existing symlink → src/index.ts (the legacy layout).
    await symlink(join(ws, "src", "index.ts"), launcherPath);
    expect((await lstat(launcherPath)).isSymbolicLink()).toBe(true);

    await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => bunPath,
    });

    const stat = await lstat(launcherPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
    // Confirm the entry script wasn't corrupted (writeFile would have
    // written through the symlink without the rm-first guard).
    const entry = await readFile(join(ws, "src", "index.ts"), "utf8");
    expect(entry).toBe("// fixture\n");
  });

  it("is idempotent: byte-identical output across repeated runs", async () => {
    const ws = await makeFakeWorkspace();
    const bunPath = await makeFakeBun();
    const launcherPath = join(tmpRoot, "smith");

    await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => bunPath,
    });
    const first = await readFile(launcherPath, "utf8");

    await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => bunPath,
    });
    const second = await readFile(launcherPath, "utf8");

    expect(second).toBe(first);
  });

  it("returns ok:false (not a throw) when bun resolves to null", async () => {
    const ws = await makeFakeWorkspace();
    const launcherPath = join(tmpRoot, "smith");

    const result = await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("bun");
  });

  it("returns ok:false (not a throw) when bun resolves to a relative path", async () => {
    const ws = await makeFakeWorkspace();
    const launcherPath = join(tmpRoot, "smith");

    const result = await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => "bun",
    });

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when the entry script is missing", async () => {
    const bunPath = await makeFakeBun();
    const launcherPath = join(tmpRoot, "smith");

    const result = await writeLauncher({
      workspacePath: join(tmpRoot, "nonexistent"),
      launcherPath,
      resolveBun: () => bunPath,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("entry script not found");
  });

  it("creates the parent directory if it doesn't exist", async () => {
    const ws = await makeFakeWorkspace();
    const bunPath = await makeFakeBun();
    const nestedDir = join(tmpRoot, "nested", "deeper");
    const launcherPath = join(nestedDir, "smith");

    const result = await writeLauncher({
      workspacePath: ws,
      launcherPath,
      resolveBun: () => bunPath,
    });

    expect(result.ok).toBe(true);
    expect((await lstat(launcherPath)).isFile()).toBe(true);
  });
});
