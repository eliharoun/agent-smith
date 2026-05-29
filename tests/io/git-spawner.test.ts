import { describe, test, expect } from "bun:test";
import { defaultGitSpawner } from "../../src/core/knowledge/acquire";

// Skip gracefully on environments where git is not installed (e.g. minimal CI).
const hasGit = await (async () => {
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
})();

describe("defaultGitSpawner: production smoke", () => {
  test.skipIf(!hasGit)(
    "git --version returns code 0 and stdout containing 'git'",
    async () => {
      const result = await defaultGitSpawner(["--version"], process.cwd());
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("git");
    },
  );
});
