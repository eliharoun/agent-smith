import { describe, expect, test } from "bun:test";
import { getOriginRemote, lsRemote, pullIfClean, revListCount, revParse } from "../../src/io/git";
import { runGit, GIT_TRANSPORT_ALLOWLIST } from "../../src/io/git";
import { SmithError } from "../../src/core/smith-error";

describe("runGit: hardened chokepoint", () => {
  function recordingStub(record: { cmd?: string[]; env?: Record<string, string> | undefined }) {
    return (cmd: string[], opts: { env?: Record<string, string> }) => {
      record.cmd = cmd;
      record.env = opts.env;
      return { exited: Promise.resolve(0), stdout: new Response("ok").body!, stderr: new Response("").body! };
    };
  }

  test("prepends git + transport allowlist before the subcommand", async () => {
    const rec: { cmd?: string[] } = {};
    await runGit(["clone", "https://x/y", "/tmp/z"], "/tmp", { spawnFn: recordingStub(rec) as never });
    expect(rec.cmd?.[0]).toBe("git");
    expect(rec.cmd).toContain("protocol.allow=never");
    expect(rec.cmd!.indexOf("clone")).toBeGreaterThan(rec.cmd!.indexOf("protocol.allow=never"));
  });

  test("sets GIT_TERMINAL_PROMPT=0 and GIT_ASKPASS= in spawn env", async () => {
    const rec: { env?: Record<string, string> } = {};
    await runGit(["--version"], "/tmp", { spawnFn: recordingStub(rec) as never });
    expect(rec.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(rec.env?.GIT_ASKPASS).toBe("");
  });

  test("maps ENOENT to a canonical 'git not installed' SmithError", async () => {
    const enoent = () => { const e: NodeJS.ErrnoException = new Error("nope"); e.code = "ENOENT"; throw e; };
    const err = await runGit(["--version"], "/tmp", { spawnFn: enoent as never }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("executable");
    expect(err.payload.identifier).toBe("git");
  });

  test("returns {stdout,stderr,code} on normal exit", async () => {
    const rec: { cmd?: string[] } = {};
    const r = await runGit(["status"], "/tmp", { spawnFn: recordingStub(rec) as never });
    expect(r).toEqual({ stdout: "ok", stderr: "", code: 0 });
  });

  test("GIT_TRANSPORT_ALLOWLIST is the canonical 4-protocol set", () => {
    expect(GIT_TRANSPORT_ALLOWLIST).toContain("protocol.allow=never");
    expect(GIT_TRANSPORT_ALLOWLIST).toContain("protocol.https.allow=always");
    expect(GIT_TRANSPORT_ALLOWLIST).toContain("protocol.ssh.allow=always");
    expect(GIT_TRANSPORT_ALLOWLIST).toContain("protocol.file.allow=user");
  });

  test("timeoutMs kills a hung child and resolves as a nonzero failure (not a throw)", async () => {
    const r = await runGit(["--version"], "/tmp", {
      timeoutMs: 200,
      spawnFn: ((_cmd: string[], opts: { signal?: AbortSignal }) =>
        Bun.spawn(["sh", "-c", "sleep 30"], { ...opts, stdout: "pipe", stderr: "pipe" })) as never,
    });
    expect(r.code).not.toBe(0);
  });
});

describe("io/git", () => {
  test("pulls when working tree is clean", async () => {
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "pull") return { stdout: "Already up to date.", stderr: "", code: 0 };
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("clean");
    if (result.status === "clean") {
      expect(result.output).toBe("Already up to date.");
    }
    expect(calls.some((c) => c[0] === "pull" && c.includes("--ff-only"))).toBe(true);
  });

  test("returns 'dirty' with porcelain output when working tree is dirty", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") {
        return { stdout: " M file.txt\n", stderr: "", code: 0 };
      }
      throw new Error("should not run pull");
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("dirty");
    if (result.status === "dirty") {
      expect(result.porcelain).toBe(" M file.txt\n");
    }
  });

  test("returns 'error' when git status fails", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") {
        return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
      }
      throw new Error("should not run pull");
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("git status failed");
      expect(result.message).toContain("not a git repository");
    }
  });

  test("returns 'error' when git pull --ff-only fails (e.g. non-fast-forward)", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "pull") {
        return {
          stdout: "",
          stderr: "fatal: Not possible to fast-forward, aborting.",
          code: 128,
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("git pull failed");
      expect(result.message).toContain("fast-forward");
    }
  });

  test("prepends fast-forward remediation hint when pull rejected as non-ff", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "pull") {
        return {
          stdout: "",
          stderr: "fatal: Not possible to fast-forward, aborting.",
          code: 128,
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/^Fast-forward not possible/);
      expect(result.message).toContain("Stash or rebase");
      expect(result.message).toContain("git pull failed");
    }
  });

  test("prepends no-upstream remediation hint when pull complains about missing upstream", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "pull") {
        return {
          stdout: "",
          stderr: "There is no tracking information for the current branch.\nfatal: no upstream configured for branch 'feat'",
          code: 1,
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/^Branch has no upstream configured/);
      expect(result.message).toContain("--set-upstream-to");
      expect(result.message).toContain("git pull failed");
    }
  });

  test("prepends auth remediation hint when pull fails on authentication", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "pull") {
        return {
          stdout: "",
          stderr: "fatal: Authentication failed for 'https://example.com/repo.git/'",
          code: 128,
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const result = await pullIfClean("/x", { runner });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/^Git authentication failed/);
      expect(result.message).toContain("credential helper");
      expect(result.message).toContain("git pull failed");
    }
  });
});

describe("io/git lsRemote", () => {
  test("returns ok with the SHA of the remote HEAD", async () => {
    const fakeRunner = async (args: string[]) => {
      expect(args).toEqual(["ls-remote", "origin", "HEAD"]);
      return { stdout: "abc123def456\tHEAD\n", stderr: "", code: 0 };
    };
    const result = await lsRemote("/some/cwd", "origin", { runner: fakeRunner });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe("abc123def456");
  });

  test("returns reason 'exit-code' with stderr detail when ls-remote fails", async () => {
    const fakeRunner = async () => ({ stdout: "", stderr: "no upstream\n", code: 128 });
    const result = await lsRemote("/some/cwd", "origin", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("exit-code");
    expect(result.detail).toBe("no upstream");
  });

  test("returns reason 'empty' when stdout is empty on success exit", async () => {
    const fakeRunner = async () => ({ stdout: "", stderr: "", code: 0 });
    const result = await lsRemote("/some/cwd", "origin", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("empty");
  });
});

describe("io/git revParse", () => {
  test("returns ok with the SHA of the named ref", async () => {
    const fakeRunner = async (args: string[]) => {
      expect(args).toEqual(["rev-parse", "HEAD"]);
      return { stdout: "abc123\n", stderr: "", code: 0 };
    };
    const result = await revParse("/some/cwd", "HEAD", { runner: fakeRunner });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe("abc123");
  });

  test("returns reason 'exit-code' with stderr detail when rev-parse fails", async () => {
    const fakeRunner = async () => ({ stdout: "", stderr: "bad ref\n", code: 128 });
    const result = await revParse("/some/cwd", "BAD", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("exit-code");
    expect(result.detail).toBe("bad ref");
  });

  test("returns reason 'empty' when stdout is whitespace on success exit", async () => {
    const fakeRunner = async () => ({ stdout: "  \n", stderr: "", code: 0 });
    const result = await revParse("/some/cwd", "HEAD", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("empty");
  });
});

describe("io/git revListCount", () => {
  test("returns ok with the count of commits in the given range", async () => {
    const fakeRunner = async (args: string[]) => {
      expect(args).toEqual(["rev-list", "--count", "HEAD..origin/main"]);
      return { stdout: "3\n", stderr: "", code: 0 };
    };
    const result = await revListCount("/cwd", "HEAD..origin/main", { runner: fakeRunner });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(3);
  });

  test("returns reason 'exit-code' with stderr detail on failure", async () => {
    const fakeRunner = async () => ({ stdout: "", stderr: "bad\n", code: 128 });
    const result = await revListCount("/cwd", "X..Y", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("exit-code");
    expect(result.detail).toBe("bad");
  });

  test("returns reason 'empty' when stdout is blank on success exit", async () => {
    const fakeRunner = async () => ({ stdout: "  \n", stderr: "", code: 0 });
    const result = await revListCount("/cwd", "X..Y", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("empty");
  });

  test("returns reason 'parse' with detail when output is not a number", async () => {
    const fakeRunner = async () => ({ stdout: "garbage\n", stderr: "", code: 0 });
    const result = await revListCount("/cwd", "X..Y", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("parse");
    expect(result.detail).toBe("garbage");
  });

  test("returns reason 'parse' when stdout is partial-numeric like '3abc'", async () => {
    const fakeRunner = async () => ({ stdout: "3abc\n", stderr: "", code: 0 });
    const result = await revListCount("/cwd", "X..Y", { runner: fakeRunner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("parse");
    expect(result.detail).toBe("3abc");
  });
});

describe("io/git getOriginRemote", () => {
  test("returns the trimmed origin URL on success", async () => {
    const fakeRunner = async (args: string[]) => {
      expect(args).toEqual(["remote", "get-url", "origin"]);
      return {
        stdout: "git@github.com:eliharoun/agent-smith.git\n",
        stderr: "",
        code: 0,
      };
    };
    const url = await getOriginRemote("/cwd", { runner: fakeRunner });
    expect(url).toBe("git@github.com:eliharoun/agent-smith.git");
  });

  test("returns undefined when git exits non-zero", async () => {
    const fakeRunner = async () => ({
      stdout: "",
      stderr: "fatal: No such remote 'origin'\n",
      code: 128,
    });
    const url = await getOriginRemote("/cwd", { runner: fakeRunner });
    expect(url).toBeUndefined();
  });

  test("returns undefined when stdout is empty on success exit", async () => {
    const fakeRunner = async () => ({ stdout: "  \n", stderr: "", code: 0 });
    const url = await getOriginRemote("/cwd", { runner: fakeRunner });
    expect(url).toBeUndefined();
  });

  test("returns undefined when the runner throws (e.g. timeout/binary missing)", async () => {
    const fakeRunner = async () => {
      throw new Error("ENOENT: git not found");
    };
    const url = await getOriginRemote("/cwd", { runner: fakeRunner });
    expect(url).toBeUndefined();
  });
});

// Real-git integration: prove the allowlist is ENFORCED by git, not just present as strings.
// Skip gracefully where git is not installed (e.g. minimal CI).
const hasGit = await (async () => {
  try {
    const p = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
    await p.exited;
    return p.exitCode === 0;
  } catch {
    return false;
  }
})();

describe("runGit: transport allowlist is enforced by git (integration)", () => {
  test.skipIf(!hasGit)("refuses an ext:: transport via protocol.allow=never", async () => {
    // ext:: runs an arbitrary command as a git transport — the canonical thing
    // protocol.allow=never must block. We expect a non-zero exit and a
    // protocol/transport-related error, NOT the command actually running.
    const r = await runGit(["ls-remote", "ext::sh -c whoami"], process.cwd());
    expect(r.code).not.toBe(0);
    // Wording varies across git versions; assert the load-bearing fact (refused)
    // and, best-effort, that the reason is transport/protocol.
    expect(r.stderr.toLowerCase()).toMatch(/protocol|transport|not allowed|disabled|blocked/);
  });
});
