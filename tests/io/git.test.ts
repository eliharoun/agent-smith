import { describe, expect, test } from "bun:test";
import { getOriginRemote, lsRemote, pullIfClean, revListCount, revParse } from "../../src/io/git";

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
