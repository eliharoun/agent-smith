import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunResult, Runner } from "../../src/io/git";
import { runUpdateCli } from "../../src/cli/commands/update";
import { EXIT_RUNTIME } from "../../src/cli/exit-codes";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "smith-update-"));
});

afterEach(async () => {
  // Bun cleans tmp.
});

/**
 * Build a fake workspace with a package.json named "agent-smith" so that
 * resolveWorkspacePath returns the directory. Returns an importMetaUrl
 * pointing at a fictional source file under that workspace.
 */
async function fakeWorkspace(): Promise<{
  workspace: string;
  importMetaUrl: string;
}> {
  const workspace = tmpDir;
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ name: "agent-smith" }),
  );
  const srcDir = join(workspace, "src", "cli", "commands");
  await mkdir(srcDir, { recursive: true });
  return {
    workspace,
    importMetaUrl: pathToFileURL(join(srcDir, "update.ts")).href,
  };
}

/**
 * Build a runner whose responses are dispatched by matching the args array
 * via a string predicate. First matching entry wins. Records every invocation.
 */
function makeRunner(
  handlers: Array<{ match: (args: string[]) => boolean; result: RunResult }>,
): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: Runner = async (args) => {
    calls.push(args);
    const handler = handlers.find((h) => h.match(args));
    if (!handler) {
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    }
    return handler.result;
  };
  return { runner, calls };
}

describe("runUpdateCli", () => {
  test("returns EXIT_RUNTIME with a reinstall pointer when workspace path cannot be resolved", async () => {
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      // /tmp has no agent-smith package.json above it.
      importMetaUrl: pathToFileURL("/tmp/non-existent-smith-workspace/index.ts")
        .href,
      runner: () => Promise.reject(new Error("runner must not be called")),
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called")),
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called")),
    });
    expect(code).toBe(EXIT_RUNTIME);
    const all = lines.join("\n");
    expect(all).toContain("could not resolve agent-smith workspace");
    // Pin down the actionable reinstall command, not just the word
    // "reinstall" (which appears twice in the copy and would let a future
    // copy edit silently drop the pointer).
    expect(all).toContain("bash ~/.agent-smith/bin/install");
    // The old strings must NOT appear.
    expect(all).not.toContain("Building a standalone binary");
    expect(all).not.toContain("compiled-binary install");
  });

  test("refuses when workspace is dirty", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      // pullIfClean's status --porcelain reports dirty; the porcelain
      // output is now returned in the PullResult itself, so we don't
      // need a separate `status --short` handler.
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: " M src/foo.ts\n", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called")),
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called")),
    });
    expect(code).toBe(1);
    const out = lines.join("\n");
    expect(out).toContain("uncommitted changes");
    expect(out).toContain(" M src/foo.ts");
  });

  test("happy path: pull, install, doctor all succeed", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      // pullIfClean: clean status, then successful pull.
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "Already up to date.\n", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    let bunInstallCalled = false;
    let guiBuildCalled = false;
    let reinstallCalled = false;
    let doctorCalled = false;
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: async () => {
        bunInstallCalled = true;
        return { ok: true };
      },
      runGuiBuild: async () => {
        guiBuildCalled = true;
        return { ok: true };
      },
      runReinstall: async () => {
        reinstallCalled = true;
        return { ok: true };
      },
      runDoctor: async () => {
        doctorCalled = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(bunInstallCalled).toBe(true);
    expect(guiBuildCalled).toBe(true);
    expect(reinstallCalled).toBe(true);
    expect(doctorCalled).toBe(true);
    const out = lines.join("\n");
    expect(out).toMatch(
      /Pulled latest[\s\S]*Dependencies up to date[\s\S]*Rebuilding GUI bundle[\s\S]*GUI bundle rebuilt[\s\S]*Refreshing agent-smith knowledge[\s\S]*Running smith doctor/,
    );
  });

  test("propagates non-zero exit code from doctor", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const code = await runUpdateCli({
      dryRun: false,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: true }),
      runReinstall: async () => ({ ok: true }),
      runDoctor: async () => 1,
    });
    expect(code).toBe(1);
  });

  test("bun install failure returns 3", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    let doctorCalled = false;
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: false, error: "lockfile mismatch" }),
      runDoctor: async () => {
        doctorCalled = true;
        return 0;
      },
    });
    expect(code).toBe(3);
    expect(doctorCalled).toBe(false);
    expect(lines.join("\n")).toContain("lockfile mismatch");
  });

  test("dry-run path: fetches and reports incoming commit count", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner, calls } = makeRunner([
      {
        match: (a) => a[0] === "fetch",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "rev-list" && a[1] === "--count",
        result: { stdout: "5\n", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    let bunInstallCalled = false;
    let doctorCalled = false;
    const code = await runUpdateCli({
      dryRun: true,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: async () => {
        bunInstallCalled = true;
        return { ok: true };
      },
      runDoctor: async () => {
        doctorCalled = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(bunInstallCalled).toBe(false);
    expect(doctorCalled).toBe(false);
    expect(lines.join("\n")).toContain("would pull 5 commit(s)");
    // Ensure no `pull --ff-only` was attempted.
    expect(calls.some((c) => c[0] === "pull")).toBe(false);
  });

  test("dry-run with already-current workspace", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "fetch",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "rev-list" && a[1] === "--count",
        result: { stdout: "0\n", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: true,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called")),
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called")),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Already up to date");
  });

  test("dry-run: git fetch failure returns exit 3 and surfaces stderr", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner, calls } = makeRunner([
      {
        match: (a) => a[0] === "fetch",
        result: { stdout: "", stderr: "fatal: unable to access\n", code: 128 },
      },
    ]);
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: true,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called")),
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called")),
    });
    expect(code).toBe(3);
    expect(lines.join("\n")).toContain("git fetch failed");
    expect(lines.join("\n")).toContain("fatal: unable to access");
    // rev-list must not be attempted after fetch failure.
    expect(calls.some((c) => c[0] === "rev-list")).toBe(false);
  });

  test("non-dry-run: pullIfClean error branch returns exit 3 with surfaced message", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    // pullIfClean returns { status: "error" } when `git status --porcelain`
    // itself exits non-zero (src/io/git.ts:49-51).
    const { runner, calls } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "fatal: not a git repository", code: 128 },
      },
    ]);
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called")),
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called")),
    });
    expect(code).toBe(3);
    expect(lines.join("\n")).toContain("Update failed");
    expect(lines.join("\n")).toContain("not a git repository");
    // No pull attempted.
    expect(calls.some((c) => c[0] === "pull")).toBe(false);
  });

  test("calls runReinstall after bun install with the workspace path and 'agent-smith'", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const reinstallCalls: Array<{ workspace: string; agent: string }> = [];
    const code = await runUpdateCli({
      dryRun: false,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: true }),
      runReinstall: async (workspace, agent) => {
        reinstallCalls.push({ workspace, agent });
        return { ok: true };
      },
      runDoctor: async () => 0,
    });
    expect(code).toBe(0);
    expect(reinstallCalls.length).toBe(1);
    expect(reinstallCalls[0]?.agent).toBe("agent-smith");
    expect(typeof reinstallCalls[0]?.workspace).toBe("string");
    expect(reinstallCalls[0]?.workspace.length).toBeGreaterThan(0);
  });

  test("reinstall failure + doctor=0 returns EXIT_PARTIAL with the partial message", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: true }),
      runReinstall: async () => ({ ok: false, error: "knowledge dir lock contention" }),
      runDoctor: async () => 0,
    });
    expect(code).toBe(3);
    const out = lines.join("\n");
    expect(out).toContain("agent-smith reinstall failed");
    expect(out).toContain("knowledge dir lock contention");
    expect(out).toContain("smith agent install agent-smith");
  });

  test("reinstall failure + doctor=1 returns 1 (doctor drift takes precedence)", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const code = await runUpdateCli({
      dryRun: false,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: true }),
      runReinstall: async () => ({ ok: false, error: "..." }),
      runDoctor: async () => 1,
    });
    expect(code).toBe(1);
  });

  test("reinstall failure + doctor=2 returns 2 (doctor network takes precedence)", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const code = await runUpdateCli({
      dryRun: false,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: true }),
      runReinstall: async () => ({ ok: false, error: "..." }),
      runDoctor: async () => 2,
    });
    expect(code).toBe(2);
  });

  test("dry run does NOT invoke runReinstall", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "fetch" && a[1] === "origin" && a[2] === "main",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) =>
          a[0] === "rev-list" && a[1] === "--count" && a[2] === "HEAD..origin/main",
        result: { stdout: "0\n", stderr: "", code: 0 },
      },
    ]);
    let reinstallCalled = false;
    const code = await runUpdateCli({
      dryRun: true,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: () =>
        Promise.reject(new Error("bunInstall must not be called in dry-run")),
      runReinstall: async () => {
        reinstallCalled = true;
        return { ok: true };
      },
      runDoctor: () =>
        Promise.reject(new Error("runDoctor must not be called in dry-run")),
    });
    expect(code).toBe(0);
    expect(reinstallCalled).toBe(false);
  });

  test("GUI build failure + doctor=0 returns EXIT_PARTIAL but reinstall and doctor still run", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const lines: string[] = [];
    let reinstallCalled = false;
    let doctorCalled = false;
    const code = await runUpdateCli({
      dryRun: false,
      print: (s) => lines.push(s),
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: false, error: "vite exited with code 1" }),
      runReinstall: async () => {
        reinstallCalled = true;
        return { ok: true };
      },
      runDoctor: async () => {
        doctorCalled = true;
        return 0;
      },
    });
    // Warn-and-continue: subsequent steps must still run.
    expect(reinstallCalled).toBe(true);
    expect(doctorCalled).toBe(true);
    // Soft-fail surfaces as EXIT_PARTIAL when doctor itself was clean.
    expect(code).toBe(3);
    const out = lines.join("\n");
    expect(out).toContain("GUI build failed");
    expect(out).toContain("vite exited with code 1");
    expect(out).toContain("bun run gui:build");
  });

  test("GUI build failure + doctor=1 returns 1 (doctor drift takes precedence)", async () => {
    const { importMetaUrl } = await fakeWorkspace();
    const { runner } = makeRunner([
      {
        match: (a) => a[0] === "status" && a[1] === "--porcelain",
        result: { stdout: "", stderr: "", code: 0 },
      },
      {
        match: (a) => a[0] === "pull" && a[1] === "--ff-only",
        result: { stdout: "", stderr: "", code: 0 },
      },
    ]);
    const code = await runUpdateCli({
      dryRun: false,
      print: () => {},
      importMetaUrl,
      runner,
      bunInstall: async () => ({ ok: true }),
      runGuiBuild: async () => ({ ok: false, error: "..." }),
      runReinstall: async () => ({ ok: true }),
      runDoctor: async () => 1,
    });
    expect(code).toBe(1);
  });
});
