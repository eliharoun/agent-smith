// tests/fixtures/git-remote-helper.ts
//
// Spin up a local bare git repo in a tmpdir, push initial commits, and
// return a path that downstream tests can clone from as if it were a
// remote URL. Avoids network dependency in CI.
//
// Usage:
//   const remote = await createBareRemote();
//   await remote.commitFile("agent.config.json", '{"name":"foo",...}');
//   const url = remote.url; // file:// URL accepted by git clone
//   await remote.cleanup();

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface BareRemote {
  /** file:// URL the bare repo lives at; usable as a git clone target. */
  url: string;
  /** Working-tree path (separate from the bare repo) used to stage commits. */
  workdir: string;
  /** Commit a file (creates parent dirs); pushes to the bare remote. */
  commitFile(relPath: string, contents: string, message?: string): Promise<string>;
  /** Returns current HEAD sha on the bare remote (40-char hex). */
  headSha(): Promise<string>;
  /** Best-effort tmpdir cleanup. */
  cleanup(): Promise<void>;
}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} ${args.join(" ")}: exit ${code}: ${stderr}`));
    });
  });
}

export async function createBareRemote(): Promise<BareRemote> {
  const root = await mkdtemp(join(tmpdir(), "smith-git-fixture-"));
  const bareDir = join(root, "bare.git");
  const workdir = join(root, "work");

  await mkdir(bareDir, { recursive: true });
  await run("git", ["init", "--bare", "-b", "main", bareDir], root);

  await mkdir(workdir, { recursive: true });
  await run("git", ["init", "-b", "main"], workdir);
  await run("git", ["config", "user.email", "test@example.com"], workdir);
  await run("git", ["config", "user.name", "Test"], workdir);
  await run("git", ["config", "commit.gpgsign", "false"], workdir);
  await run("git", ["remote", "add", "origin", bareDir], workdir);

  // Seed with an empty initial commit so the first push has something to push.
  await run("git", ["commit", "--allow-empty", "-m", "init"], workdir);
  await run("git", ["push", "-u", "origin", "main"], workdir);

  return {
    url: `file://${bareDir}`,
    workdir,
    async commitFile(
      relPath: string,
      contents: string,
      message = `add ${relPath}`,
    ): Promise<string> {
      const full = join(workdir, relPath);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents, "utf-8");
      await run("git", ["add", relPath], workdir);
      await run("git", ["commit", "-m", message], workdir);
      await run("git", ["push", "origin", "main"], workdir);
      return run("git", ["rev-parse", "HEAD"], workdir);
    },
    async headSha(): Promise<string> {
      return run("git", ["rev-parse", "HEAD"], bareDir);
    },
    async cleanup(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    },
  };
}
