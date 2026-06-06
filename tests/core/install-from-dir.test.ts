import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromDir } from "../../src/core/install-from-dir";
import { canonicalRegistryPath, loadRegistry } from "../../src/io/registry";
import { stateHome } from "../../src/io/state-home";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "install-from-dir-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
});

async function seedCatalog(): Promise<string> {
  const catalog = await mkdtemp(join(tmpdir(), "team-agents-"));
  const bundleDir = join(catalog, "agents", "code-reviewer");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "code-reviewer",
      description: "Use proactively as a local-dir install fixture.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "subagent",
    }),
  );
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(bundleDir, f), "placeholder\n");
  }
  return catalog;
}

async function seedFlatCatalog(): Promise<string> {
  const catalog = await mkdtemp(join(tmpdir(), "team-agents-flat-"));
  const bundleDir = join(catalog, "code-reviewer");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "code-reviewer",
      description: "Use proactively as a flat local-dir install fixture.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "subagent",
    }),
  );
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(bundleDir, f), "placeholder\n");
  }
  return catalog;
}

describe("installFromDir", () => {
  test("registers the directory as a kind: registered catalog", async () => {
    const catalog = await seedCatalog();
    try {
      const result = await installFromDir({ localPath: catalog });
      expect(result.bundles).toContain("code-reviewer");
      // Nested layout: catalog root is <catalog>/agents/, not <catalog>.
      expect(result.catalogRootPath).toBe(join(catalog, "agents"));
      const reg = await loadRegistry(canonicalRegistryPath());
      const entry = reg.sources.find((s) => s.rootPath === join(catalog, "agents"));
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe("registered");
      expect(entry?.gitRemote).toBeUndefined();
    } finally {
      await rm(catalog, { recursive: true, force: true });
    }
  });

  test("returns detectedGitRemote when the directory is a git repo", async () => {
    const catalog = await seedCatalog();
    try {
      await mkdir(join(catalog, ".git"));
      await writeFile(
        join(catalog, ".git", "config"),
        `[remote "origin"]\n\turl = git@github.com:acme/team-agents.git\n`,
      );
      const result = await installFromDir({ localPath: catalog });
      expect(result.detectedGitRemote).toBe("git@github.com:acme/team-agents.git");
    } finally {
      await rm(catalog, { recursive: true, force: true });
    }
  });

  test("does not return detectedGitRemote when the directory is not a git repo", async () => {
    const catalog = await seedCatalog();
    try {
      const result = await installFromDir({ localPath: catalog });
      expect(result.detectedGitRemote).toBeUndefined();
    } finally {
      await rm(catalog, { recursive: true, force: true });
    }
  });

  test("refuses paths inside <stateHome>/remote/", async () => {
    const insideRemote = join(stateHome(), "remote", "github.com", "acme", "team-agents");
    await mkdir(insideRemote, { recursive: true });
    await expect(installFromDir({ localPath: insideRemote })).rejects.toMatchObject({
      payload: { code: "validation-failed", what: "install --from" },
    });
  });

  test("refuses if the directory is already registered", async () => {
    const catalog = await seedCatalog();
    try {
      await installFromDir({ localPath: catalog });
      await expect(installFromDir({ localPath: catalog })).rejects.toMatchObject({
        payload: { code: "validation-failed", what: "install --from" },
      });
    } finally {
      await rm(catalog, { recursive: true, force: true });
    }
  });

  test("refuses if the directory contains no agent.config.json", async () => {
    const empty = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(installFromDir({ localPath: empty })).rejects.toMatchObject({
        payload: { code: "validation-failed", what: "install --from" },
      });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("includes 'smith agent unregister <label>' hint when the existing entry's rootPath no longer exists", async () => {
    // Use flat layout so catalogRootPath === abs (catalog). The early duplicate
    // check fires on the second call even after the directory is deleted,
    // allowing the stat() failure to surface the stale hint.
    const catalog = await seedFlatCatalog();

    // First install — registers the catalog at `catalog` (flat layout).
    await installFromDir({ localPath: catalog });

    // Now delete the catalog directory so the registered rootPath becomes stale.
    await rm(catalog, { recursive: true, force: true });

    // Re-attempt install on the deleted path. The early duplicate guard fires
    // because `catalog` (abs) is registered; stat() fails because the path is
    // gone; the staleHint should surface.
    await expect(installFromDir({ localPath: catalog })).rejects.toMatchObject({
      payload: {
        code: "validation-failed",
        what: "install --from",
        reasons: [expect.stringContaining("smith agent unregister")],
      },
    });
  });

  test("registers the inner agents/ dir when bundles live in a catalog layout", async () => {
    // Catalog layout: <catalog>/agents/code-reviewer/agent.config.json
    const catalog = await mkdtemp(join(tmpdir(), "team-agents-nested-"));
    const bundleDir = join(catalog, "agents", "code-reviewer");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "agent.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "code-reviewer",
        description: "Use proactively as a nested-catalog test fixture.",
        targets: ["claude-code"],
        modelTier: "balanced",
        mode: "subagent",
      }),
    );
    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
      await writeFile(join(bundleDir, f), "placeholder\n");
    }
    try {
      const result = await installFromDir({ localPath: catalog });
      expect(result.bundles).toContain("code-reviewer");
      // Catalog root should be <catalog>/agents/, not <catalog>.
      expect(result.catalogRootPath).toBe(join(catalog, "agents"));
      const reg = await loadRegistry(canonicalRegistryPath());
      const entry = reg.sources.find((s) => s.rootPath === join(catalog, "agents"));
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe("registered");
    } finally {
      await rm(catalog, { recursive: true, force: true });
    }
  });

});
