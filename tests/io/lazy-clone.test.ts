import { describe, expect, mock, test } from "bun:test";
import { ensureCloneExists } from "../../src/io/lazy-clone";

describe("ensureCloneExists", () => {
  test("clones when rootPath does not exist and gitRemote is set", async () => {
    const cloneCalls: Array<{ url: string; targetDir: string }> = [];
    const cloneFn = mock(async (opts: { url: string; ref: string; targetDir: string }) => {
      cloneCalls.push({ url: opts.url, targetDir: opts.targetDir });
      return { sha: "abc123", fetched: false };
    });
    await ensureCloneExists(
      {
        rootPath: "/tmp/missing/dir",
        gitRemote: "https://github.com/langpingxue/atlassian-skills.git",
        remote: { url: "https://github.com/langpingxue/atlassian-skills.git", ref: "HEAD" },
      },
      { cloneFn: cloneFn as never, pathExists: async () => false },
    );
    expect(cloneCalls.length).toBe(1);
    expect(cloneCalls[0]?.url).toBe("https://github.com/langpingxue/atlassian-skills.git");
    expect(cloneCalls[0]?.targetDir).toBe("/tmp/missing/dir");
  });

  test("no-op when rootPath already exists", async () => {
    const cloneFn = mock(async () => {
      throw new Error("should not be called");
    });
    await ensureCloneExists(
      {
        rootPath: "/tmp/exists",
        gitRemote: "https://github.com/langpingxue/atlassian-skills.git",
      },
      { cloneFn: cloneFn as never, pathExists: async () => true },
    );
    expect(cloneFn).toHaveBeenCalledTimes(0);
  });

  test("no-op when gitRemote is unset", async () => {
    const cloneFn = mock(async () => {
      throw new Error("should not be called");
    });
    await ensureCloneExists(
      { rootPath: "/tmp/missing" },
      { cloneFn: cloneFn as never, pathExists: async () => false },
    );
    expect(cloneFn).toHaveBeenCalledTimes(0);
  });

  test("propagates clone failure", async () => {
    const cloneFn = mock(async () => {
      throw new Error("network unreachable");
    });
    await expect(
      ensureCloneExists(
        {
          rootPath: "/tmp/missing",
          gitRemote: "https://github.com/langpingxue/atlassian-skills.git",
        },
        { cloneFn: cloneFn as never, pathExists: async () => false },
      ),
    ).rejects.toThrow(/network unreachable/);
  });
});
