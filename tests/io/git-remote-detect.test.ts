import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGitRemote } from "../../src/io/git-remote-detect";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-remote-detect-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detectGitRemote", () => {
  test("returns undefined when .git/ does not exist", async () => {
    expect(await detectGitRemote(dir)).toBeUndefined();
  });

  test("returns undefined when .git/config has no origin remote", async () => {
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n");
    expect(await detectGitRemote(dir)).toBeUndefined();
  });

  test("returns origin URL from a typical .git/config", async () => {
    await mkdir(join(dir, ".git"));
    await writeFile(
      join(dir, ".git", "config"),
      `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:acme/team-agents.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`,
    );
    expect(await detectGitRemote(dir)).toBe("git@github.com:acme/team-agents.git");
  });

  test("returns origin even when other remotes are present", async () => {
    await mkdir(join(dir, ".git"));
    await writeFile(
      join(dir, ".git", "config"),
      `[remote "upstream"]
\turl = https://github.com/upstream/repo.git
[remote "origin"]
\turl = https://github.com/me/repo.git
`,
    );
    expect(await detectGitRemote(dir)).toBe("https://github.com/me/repo.git");
  });

  test("returns undefined for a malformed config", async () => {
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "config"), "{{not valid INI}}");
    expect(await detectGitRemote(dir)).toBeUndefined();
  });
});
