import { describe, expect, it } from "bun:test";
import { verifyGitRemote } from "./git-verify";

const failSpawn = async (): Promise<{ stdout: string; stderr: string; code: number }> => ({
  stdout: "",
  stderr: "fatal",
  code: 128,
});

describe("verifyGitRemote", () => {
  it("not-a-git-repo when rev-parse fails", async () => {
    const r = await verifyGitRemote("/x", undefined, { spawnGit: failSpawn });
    expect(r).toEqual({ ok: false, reason: "not-a-git-repo" });
  });

  it("returns ok with parsed remotes when no expected", async () => {
    let call = 0;
    const r = await verifyGitRemote("/x", undefined, {
      spawnGit: async () => {
        call++;
        if (call === 1) return { stdout: "/x\n", stderr: "", code: 0 };
        return {
          stdout: "origin\thttps://e.com/r.git (fetch)\norigin\thttps://e.com/r.git (push)\n",
          stderr: "",
          code: 0,
        };
      },
    });
    expect(r).toEqual({
      ok: true,
      skipped: false,
      remotes: [{ name: "origin", url: "https://e.com/r.git" }],
    });
  });

  it("matches with .git/trailing-slash normalization", async () => {
    let call = 0;
    const r = await verifyGitRemote("/x", "https://e.com/r/", {
      spawnGit: async () => {
        call++;
        if (call === 1) return { stdout: "/x\n", stderr: "", code: 0 };
        return {
          stdout: "origin\thttps://e.com/r.git (fetch)\n",
          stderr: "",
          code: 0,
        };
      },
    });
    expect(r.ok).toBe(true);
  });

  it("remote-mismatch returns found list", async () => {
    let call = 0;
    const r = await verifyGitRemote("/x", "https://expected.com/r.git", {
      spawnGit: async () => {
        call++;
        if (call === 1) return { stdout: "/x\n", stderr: "", code: 0 };
        return {
          stdout: "origin\thttps://other.com/r.git (fetch)\n",
          stderr: "",
          code: 0,
        };
      },
    });
    expect(r).toEqual({
      ok: false,
      reason: "remote-mismatch",
      found: [{ name: "origin", url: "https://other.com/r.git" }],
    });
  });
});
