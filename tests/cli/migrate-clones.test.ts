// tests/cli/migrate-clones.test.ts
//
// Tests for `smith migrate-clones` — the one-shot rc.1 → rc.2+ clone
// migration helper. Uses real tmpdirs for the filesystem ops because
// the rename + copy-tree fallback paths exercise OS-level behavior
// that's hard to mock faithfully. Git origin reads are stubbed via
// the `readOrigin` DI seam so tests don't need real git repos —
// just stub directories with `.git/` and a stubbed origin URL.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRc1Clones, migrateClones } from "../../src/cli/commands/migrate-clones";
import { defaultRegistry, saveRegistry } from "../../src/io/registry";
import { defaultSkillRegistry, saveSkillRegistry } from "../../src/io/skill-registry";

let root: string;
let oldRemoteRoot: string;
let newRemoteRoot: string;
let agentRegistryPath: string;
let skillRegistryPath: string;

beforeEach(async () => {
  root = await mkdir(
    join(tmpdir(), `smith-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  )
    .then(() =>
      join(tmpdir(), `smith-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    )
    .catch(() => "");
  // Use a deterministic per-test root.
  root = join(tmpdir(), `smith-migrate-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  oldRemoteRoot = join(root, "config-home", "remote");
  newRemoteRoot = join(root, "state-home", "remote");
  agentRegistryPath = join(root, "registry.json");
  skillRegistryPath = join(root, "skill-catalogs.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Make a fake clone directory at `path` with stub `.git/` and a config file. */
async function makeFakeClone(path: string, originUrl: string): Promise<void> {
  await mkdir(join(path, ".git"), { recursive: true });
  await writeFile(join(path, ".git", "config"), `[remote "origin"]\n  url = ${originUrl}\n`);
  // A sentinel file inside the clone so we can verify post-move that
  // the contents arrived intact.
  await writeFile(join(path, "AGENT.md"), "# fake bundle\n");
}

/** DI seam stub: maps clone path → origin URL. */
function makeReadOrigin(map: Map<string, string>): (cwd: string) => Promise<string | undefined> {
  return async (cwd: string) => map.get(cwd);
}

describe("migrateClones", () => {
  test("happy path: single rc.1 agent clone is moved and registry updated", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    const url = "https://github.com/foo/bar.git";
    await makeFakeClone(oldPath, url);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "foo-bar",
      rootPath: oldPath,
      gitRemote: url,
      remote: { url, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
    });

    expect(result.outcomes.length).toBe(1);
    expect(result.outcomes[0]?.status).toBe("migrated");
    expect(result.anyMigrated).toBe(true);

    // Old path gone, new path has the contents.
    await expect(stat(oldPath)).rejects.toThrow();
    const newPath = join(newRemoteRoot, "github.com", "foo", "bar");
    const newAgentMd = await Bun.file(join(newPath, "AGENT.md")).text();
    expect(newAgentMd).toBe("# fake bundle\n");

    // Registry rootPath now points at new location.
    const updated = await Bun.file(agentRegistryPath).json();
    const fooBar = updated.sources.find((s: { label: string }) => s.label === "foo-bar");
    expect(fooBar?.rootPath).toBe(newPath);
  });

  test("dry-run: classifies but does not move or update registry", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    const url = "https://github.com/foo/bar.git";
    await makeFakeClone(oldPath, url);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "foo-bar",
      rootPath: oldPath,
      remote: { url, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
      dryRun: true,
    });

    expect(result.outcomes[0]?.status).toBe("migrated");
    // Old path still exists (no move), new path doesn't.
    await stat(oldPath); // would throw if missing
    await expect(stat(join(newRemoteRoot, "github.com", "foo", "bar"))).rejects.toThrow();
    // Registry unchanged.
    const stored = await Bun.file(agentRegistryPath).json();
    const fooBar = stored.sources.find((s: { label: string }) => s.label === "foo-bar");
    expect(fooBar?.rootPath).toBe(oldPath);
  });

  test("skipped: no recorded URL on entry", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    await mkdir(oldPath, { recursive: true });
    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "no-url",
      rootPath: oldPath,
      // No remote{} block, no gitRemote — entry is unrecoverable.
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map()),
    });

    expect(result.outcomes[0]?.status).toBe("skipped");
    if (result.outcomes[0]?.status === "skipped") {
      expect(result.outcomes[0].reason).toMatch(/no recorded URL/);
    }
  });

  test("skipped: .git directory missing", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    await mkdir(oldPath, { recursive: true });
    // Note: no .git/ created.
    const url = "https://github.com/foo/bar.git";
    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "no-git",
      rootPath: oldPath,
      remote: { url, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
    });

    expect(result.outcomes[0]?.status).toBe("skipped");
    if (result.outcomes[0]?.status === "skipped") {
      expect(result.outcomes[0].reason).toMatch(/\.git not found/);
    }
  });

  test("skipped: origin URL does not match recorded URL", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    const recordedUrl = "https://github.com/foo/bar.git";
    const actualOrigin = "https://github.com/different/owner.git";
    await makeFakeClone(oldPath, actualOrigin);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "mismatch",
      rootPath: oldPath,
      remote: { url: recordedUrl, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, actualOrigin]])),
    });

    expect(result.outcomes[0]?.status).toBe("skipped");
    if (result.outcomes[0]?.status === "skipped") {
      expect(result.outcomes[0].reason).toMatch(/does not match/);
    }
  });

  test("skipped: target path already exists at rc.2+ location", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    const newPath = join(newRemoteRoot, "github.com", "foo", "bar");
    const url = "https://github.com/foo/bar.git";
    await makeFakeClone(oldPath, url);
    await makeFakeClone(newPath, url); // pre-existing destination

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "duplicate",
      rootPath: oldPath,
      remote: { url, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
    });

    expect(result.outcomes[0]?.status).toBe("skipped");
    if (result.outcomes[0]?.status === "skipped") {
      expect(result.outcomes[0].reason).toMatch(/target.*already exists/);
    }
    // Old and new both still on disk (untouched).
    await stat(oldPath);
    await stat(newPath);
  });

  test("legacy gitRemote field works as URL fallback when remote{} missing", async () => {
    // rc.1 catalogs registered before the remote{} provenance block was
    // added. Migration must still work using the legacy gitRemote field.
    const oldPath = join(oldRemoteRoot, "github.com", "legacy", "repo");
    const url = "https://github.com/legacy/repo.git";
    await makeFakeClone(oldPath, url);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "legacy",
      rootPath: oldPath,
      gitRemote: url,
      // No remote{} block.
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
    });

    expect(result.outcomes[0]?.status).toBe("migrated");
    expect(result.anyMigrated).toBe(true);
  });

  test("mixed: rc.1 entry alongside rc.2+ entry — only rc.1 migrated, rc.2+ counted", async () => {
    const rc1Path = join(oldRemoteRoot, "github.com", "old", "repo");
    const rc2Path = join(newRemoteRoot, "github.com", "new", "repo");
    const url1 = "https://github.com/old/repo.git";
    const url2 = "https://github.com/new/repo.git";
    await makeFakeClone(rc1Path, url1);
    await makeFakeClone(rc2Path, url2);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "old",
      rootPath: rc1Path,
      remote: { url: url1, ref: "HEAD" },
    });
    reg.sources.push({
      kind: "registered",
      label: "new",
      rootPath: rc2Path,
      remote: { url: url2, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(
        new Map([
          [rc1Path, url1],
          [rc2Path, url2],
        ]),
      ),
    });

    expect(result.outcomes.length).toBe(1); // only the rc.1 entry has an outcome
    expect(result.outcomes[0]?.status).toBe("migrated");
    expect(result.alreadyMigrated).toBe(1); // the rc.2+ entry is counted
  });

  test("skill registry entries are migrated symmetrically", async () => {
    const oldPath = join(oldRemoteRoot, "github.com", "skills", "pack");
    const url = "https://github.com/skills/pack.git";
    await makeFakeClone(oldPath, url);

    const skillReg = defaultSkillRegistry();
    skillReg.catalogs.push({
      kind: "team-shared",
      label: "skill-pack",
      rootPath: oldPath,
      remote: { url, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, defaultRegistry());
    await saveSkillRegistry(skillRegistryPath, skillReg);

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, url]])),
    });

    expect(result.outcomes[0]?.status).toBe("migrated");
    expect(result.outcomes[0]?.kind).toBe("skill");
  });

  test("URL-shape variations match via canonical normalizer", async () => {
    // Registered remote URL is HTTPS; clone's actual origin is SSH form.
    // sameGitRemote should treat them as equivalent.
    const oldPath = join(oldRemoteRoot, "github.com", "foo", "bar");
    const recordedUrl = "https://github.com/foo/bar.git";
    const actualOrigin = "git@github.com:foo/bar"; // no .git suffix, SSH form
    await makeFakeClone(oldPath, actualOrigin);

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "ssh-vs-https",
      rootPath: oldPath,
      remote: { url: recordedUrl, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map([[oldPath, actualOrigin]])),
    });

    expect(result.outcomes[0]?.status).toBe("migrated");
  });

  test("no rc.1 clones found: outcomes empty, anyMigrated false", async () => {
    await saveRegistry(agentRegistryPath, defaultRegistry());
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await migrateClones({
      oldRemoteRoot,
      newRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
      readOrigin: makeReadOrigin(new Map()),
    });

    expect(result.outcomes.length).toBe(0);
    expect(result.anyMigrated).toBe(false);
  });
});

describe("detectRc1Clones (doctor seam)", () => {
  test("counts rc.1 catalogs across both registries", async () => {
    const url1 = "https://github.com/a/b.git";
    const url2 = "https://github.com/c/d.git";
    const oldAgentPath = join(oldRemoteRoot, "github.com", "a", "b");
    const oldSkillPath = join(oldRemoteRoot, "github.com", "c", "d");
    await mkdir(oldAgentPath, { recursive: true });
    await mkdir(oldSkillPath, { recursive: true });

    const reg = defaultRegistry();
    reg.sources.push({
      kind: "registered",
      label: "a-b",
      rootPath: oldAgentPath,
      remote: { url: url1, ref: "HEAD" },
    });
    const skillReg = defaultSkillRegistry();
    skillReg.catalogs.push({
      kind: "team-shared",
      label: "c-d",
      rootPath: oldSkillPath,
      remote: { url: url2, ref: "HEAD" },
    });
    await saveRegistry(agentRegistryPath, reg);
    await saveSkillRegistry(skillRegistryPath, skillReg);

    const result = await detectRc1Clones({
      oldRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
    });

    expect(result.count).toBe(2);
    expect(result.sample).toEqual(["agent:a-b", "skill:c-d"]);
  });

  test("returns zero when no rc.1 clones are present", async () => {
    await saveRegistry(agentRegistryPath, defaultRegistry());
    await saveSkillRegistry(skillRegistryPath, defaultSkillRegistry());

    const result = await detectRc1Clones({
      oldRemoteRoot,
      registryPath: agentRegistryPath,
      skillRegistryPath,
    });

    expect(result.count).toBe(0);
    expect(result.sample).toEqual([]);
  });
});
