import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveWorkspacePath,
  checkWorkspaceVersion,
  checkRunningWorkspaceVersion,
} from "../../src/io/workspace-version";
import type { Runner } from "../../src/io/git";

describe("io/workspace-version resolveWorkspacePath", () => {
  test("returns the directory containing package.json with name agent-smith", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    const pkg = { name: "agent-smith", version: "0.0.0" };
    await writeFile(join(tmp, "package.json"), JSON.stringify(pkg));
    await mkdir(join(tmp, "src"), { recursive: true });
    const fakeSource = join(tmp, "src", "io", "workspace-version.ts");
    const result = await resolveWorkspacePath(fakeSource);
    expect(result).toBe(tmp);
    await rm(tmp, { recursive: true, force: true });
  });

  test("returns null when no agent-smith package.json found by walking up", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    const pkg = { name: "some-other-pkg" };
    await writeFile(join(tmp, "package.json"), JSON.stringify(pkg));
    const fakeSource = join(tmp, "src", "x.ts");
    const result = await resolveWorkspacePath(fakeSource);
    expect(result).toBeNull();
    await rm(tmp, { recursive: true, force: true });
  });

  test("returns null when no package.json exists at all", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    const fakeSource = join(tmp, "deep", "nested", "src", "x.ts");
    const result = await resolveWorkspacePath(fakeSource);
    expect(result).toBeNull();
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("io/workspace-version checkWorkspaceVersion", () => {
  test("returns 'current' when local HEAD matches origin HEAD", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "abc123\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "current" });
  });

  test("returns 'behind' with commit count when local differs from upstream", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "upstream-sha\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "local-sha\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "HEAD..origin/main") return { stdout: "5\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "origin/main..HEAD") return { stdout: "0\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "behind", commitsBehind: 5 });
  });

  test("returns 'unknown' with reason 'network-error' when ls-remote fails", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "", stderr: "no network", code: 128 };
      return { stdout: "", stderr: "unreached", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "unknown", reason: "network-error" });
  });

  test("returns 'unknown' with reason 'empty-remote' when ls-remote exits 0 but stdout is empty", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "", stderr: "", code: 0 };
      return { stdout: "", stderr: "unreached", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "unknown", reason: "empty-remote" });
  });

  test("returns 'unknown' with reason 'empty-local-head' when rev-parse exits 0 but stdout is empty", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "abc123\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "  \n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unreached", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "unknown", reason: "empty-local-head" });
  });

  test("returns 'unknown' with reason 'no-local-head' when rev-parse fails", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "abc123\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "", stderr: "not a repo", code: 128 };
      return { stdout: "", stderr: "unreached", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "unknown", reason: "no-local-head" });
  });

  test("falls back to 'behind' with commitsBehind=null when both rev-lists fail", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "upstream\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "local\n", stderr: "", code: 0 };
      if (args[0] === "rev-list") return { stdout: "", stderr: "no FETCH_HEAD", code: 128 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "behind", commitsBehind: null });
  });

  test("returns 'ahead' when local has commits not in origin", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "upstream\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "local\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "HEAD..origin/main") return { stdout: "0\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "origin/main..HEAD") return { stdout: "3\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "ahead", commitsAhead: 3 });
  });

  test("returns 'diverged' when both directions have unique commits", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "upstream\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "local\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "HEAD..origin/main") return { stdout: "5\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "origin/main..HEAD") return { stdout: "2\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "diverged", commitsBehind: 5, commitsAhead: 2 });
  });

  test("returns 'ahead' with null count when only the ahead rev-list succeeds", async () => {
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "upstream\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "local\n", stderr: "", code: 0 };
      if (args[0] === "rev-list" && args[2] === "HEAD..origin/main") return { stdout: "", stderr: "fail", code: 128 };
      if (args[0] === "rev-list" && args[2] === "origin/main..HEAD") return { stdout: "3\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const result = await checkWorkspaceVersion("/some/workspace", fakeRunner);
    expect(result).toEqual({ status: "ahead", commitsAhead: 3 });
  });
});

describe("io/workspace-version checkRunningWorkspaceVersion", () => {
  test("returns 'no-workspace' when no agent-smith package.json found by walking up", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    const fakeSource = join(tmp, "deep", "src", "x.ts");
    const result = await checkRunningWorkspaceVersion(pathToFileURL(fakeSource).href);
    expect(result).toEqual({ status: "unknown", reason: "no-workspace" });
    await rm(tmp, { recursive: true, force: true });
  });

  test("returns 'non-git' when workspace found but .git is missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "agent-smith" }));
    await mkdir(join(tmp, "src"), { recursive: true });
    const fakeSource = join(tmp, "src", "x.ts");
    const result = await checkRunningWorkspaceVersion(pathToFileURL(fakeSource).href);
    expect(result).toEqual({ status: "unknown", reason: "non-git" });
    await rm(tmp, { recursive: true, force: true });
  });

  test("delegates to checkWorkspaceVersion when workspace and .git both exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "agent-smith" }));
    await mkdir(join(tmp, ".git"), { recursive: true }); // a real directory — proves the fix
    await mkdir(join(tmp, "src"), { recursive: true });
    const fakeSource = join(tmp, "src", "x.ts");
    const fakeRunner: Runner = async (args) => {
      if (args[0] === "ls-remote") return { stdout: "abc\tHEAD\n", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "abc\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    };
    const result = await checkRunningWorkspaceVersion(pathToFileURL(fakeSource).href, fakeRunner);
    expect(result).toEqual({ status: "current" });
    await rm(tmp, { recursive: true, force: true });
  });

  test("propagates non-ENOENT stat errors instead of silently returning 'non-git'", async () => {
    // Skip on root: chmod 0 does not block root from stat'ing children.
    if (process.getuid?.() === 0) return;
    const tmp = await mkdtemp(join(tmpdir(), "smith-ws-"));
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "agent-smith" }));
    await mkdir(join(tmp, "src"), { recursive: true });
    // Make .git a symlink into an unreadable directory: stat() follows the
    // symlink and needs search perm on the target's parent, which we strip.
    // This produces EACCES — a real-world case the audit calls out (dir
    // exists but is unreadable). Previously this collapsed to 'non-git';
    // now it must propagate to the doctor's outer catch.
    const blocked = join(tmp, "blocked");
    await mkdir(join(blocked, "real-git"), { recursive: true });
    await symlink(join(blocked, "real-git"), join(tmp, ".git"));
    await chmod(blocked, 0o000);
    let caught: unknown = null;
    try {
      await checkRunningWorkspaceVersion(
        pathToFileURL(join(tmp, "src", "x.ts")).href,
      );
    } catch (err) {
      caught = err;
    }
    // Restore perms before rm, regardless of outcome.
    await chmod(blocked, 0o755);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe("EACCES");
    await rm(tmp, { recursive: true, force: true });
  });
});
