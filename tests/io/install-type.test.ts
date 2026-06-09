import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getInstallInfo } from "../../src/io/install-type";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-installtype-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// Helper: a DetectDeps that resolves the workspace to `ws` and uses real pathExists.
function depsFor(ws: string | null, extra: Partial<Parameters<typeof getInstallInfo>[0]> = {}) {
  return {
    importMetaUrl: pathToFileURL(join(tmp, "src", "io", "install-type.ts")).href,
    resolveWorkspace: async () => ws,
    ...extra,
  };
}

describe("getInstallInfo", () => {
  test("source: .git present → kind source, canGitUpdate true", async () => {
    const ws = join(tmp, "clone");
    await mkdir(join(ws, ".git"), { recursive: true });
    const info = await getInstallInfo(depsFor(ws));
    expect(info.kind).toBe("source");
    expect(info.canGitUpdate).toBe(true);
    expect(info.updateCommand).toBe("smith update");
  });

  test("source even with the npm scoped name (name alone is NOT packaged)", async () => {
    const ws = join(tmp, "clone-scoped");
    await mkdir(join(ws, ".git"), { recursive: true });
    await writeFile(join(ws, "package.json"), JSON.stringify({ name: "@eliharoun/agent-smith" }));
    const info = await getInstallInfo(depsFor(ws));
    expect(info.kind).toBe("source");
  });

  test(".git as a FILE (worktree) → source", async () => {
    const ws = join(tmp, "worktree");
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    const info = await getInstallInfo(depsFor(ws));
    expect(info.kind).toBe("source");
  });

  test("packaged: no .git, npm node_modules path → npm", async () => {
    const ws = "/opt/homebrew/lib/node_modules/@eliharoun/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, { pathExists: async () => false, env: {}, homeDir: "/Users/x" }),
    );
    expect(info.kind).toBe("packaged");
    expect(info.packageManager).toBe("npm");
    expect(info.updateCommand).toBe("npm install -g @eliharoun/agent-smith");
    expect(info.canGitUpdate).toBe(false);
  });

  test("packaged: bun global path → bun", async () => {
    const ws = "/Users/x/.bun/install/global/node_modules/@eliharoun/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, { pathExists: async () => false, env: {}, homeDir: "/Users/x" }),
    );
    expect(info.packageManager).toBe("bun");
    expect(info.updateCommand).toBe("bun add -g @eliharoun/agent-smith");
  });

  test("packaged: pnpm /.pnpm/ path → pnpm", async () => {
    const ws =
      "/Users/x/Library/pnpm/global/5/.pnpm/@eliharoun+agent-smith/node_modules/@eliharoun/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, { pathExists: async () => false, env: {}, homeDir: "/Users/x" }),
    );
    expect(info.packageManager).toBe("pnpm");
    expect(info.updateCommand).toBe("pnpm add -g @eliharoun/agent-smith");
  });

  test("packaged: npm_config_user_agent overrides path heuristic", async () => {
    const ws = "/opt/homebrew/lib/node_modules/@eliharoun/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, {
        pathExists: async () => false,
        env: { npm_config_user_agent: "bun/1.1.0 npm/? node/? darwin arm64" },
        homeDir: "/Users/x",
      }),
    );
    expect(info.packageManager).toBe("bun");
  });

  test("packaged: unrecognized path → unknown manager + generic hint", async () => {
    const ws = "/some/weird/place/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, { pathExists: async () => false, env: {}, homeDir: "/Users/x" }),
    );
    expect(info.kind).toBe("packaged");
    expect(info.packageManager).toBe("unknown");
    expect(info.updateCommand).toContain("reinstall");
  });

  test("packaged: PNPM_HOME prefix (no /.pnpm/ segment) → pnpm", async () => {
    const ws = "/custom/pnpm-store/@eliharoun/agent-smith";
    const info = await getInstallInfo(
      depsFor(ws, {
        pathExists: async () => false,
        env: { PNPM_HOME: "/custom/pnpm-store" },
        homeDir: "/Users/x",
      }),
    );
    expect(info.packageManager).toBe("pnpm");
  });

  test("unknown: no workspace resolved", async () => {
    const info = await getInstallInfo(depsFor(null));
    expect(info.kind).toBe("unknown");
    expect(info.workspacePath).toBeNull();
    expect(info.updateCommand).toBeNull();
    expect(info.canGitUpdate).toBe(false);
  });

  test("EACCES on .git stat propagates (never flips to packaged)", async () => {
    const ws = join(tmp, "clone");
    const boom = async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    };
    await expect(getInstallInfo(depsFor(ws, { pathExists: boom }))).rejects.toThrow(
      /permission denied/,
    );
  });
});
