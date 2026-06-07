import { describe, expect, test } from "bun:test";
import { gitOperationError } from "../../src/core/git-error-mapper";

describe("gitOperationError", () => {
  test("classifies host-resolution failures as network-error", () => {
    const p = gitOperationError("clone repository", "https://github.com/o/r", "fatal: could not resolve host: github.com");
    expect(p.code).toBe("network-error");
    if (p.code === "network-error") {
      expect(p.operation).toBe("git clone repository");
      expect(p.url).toContain("github.com/o/r");
    }
  });

  test("classifies connection failures as network-error", () => {
    for (const stderr of [
      "fatal: unable to access 'https://...': Failed to connect",
      "Connection timed out",
      "ssh: connect to host ... Connection refused",
    ]) {
      expect(gitOperationError("fetch updates", "https://h/o/r", stderr).code).toBe("network-error");
    }
  });

  test("classifies auth failures as network-error (not a smith bug)", () => {
    const p = gitOperationError("clone repository", "https://h/o/r", "fatal: Authentication failed for 'https://h/o/r'");
    expect(p.code).toBe("network-error");
  });

  test("classifies missing repo / ref as not-found", () => {
    for (const stderr of [
      "remote: Repository not found.",
      "fatal: couldn't find remote ref nonexistent-branch",
      "error: pathspec 'v9.9.9' did not match any file(s) known to git",
    ]) {
      expect(gitOperationError("clone repository", "https://h/o/r", stderr).code).toBe("not-found");
    }
  });

  test("falls back to validation-failed for unclassified git errors", () => {
    const p = gitOperationError("reset to main", "https://h/o/r", "fatal: some unexpected git state");
    expect(p.code).toBe("validation-failed");
    if (p.code === "validation-failed") {
      expect(p.what).toBe("git reset to main");
      expect(p.reasons[0]).toContain("unexpected git state");
    }
  });

  test("handles empty stderr without crashing", () => {
    const p = gitOperationError("clone repository", "https://h/o/r", "");
    expect(p.code).toBe("validation-failed");
  });

  test("never yields an internal-error (the bug we are fixing)", () => {
    for (const stderr of ["could not resolve host", "Repository not found", "weird", ""]) {
      expect(gitOperationError("clone repository", "https://h/o/r", stderr).code).not.toBe(
        "internal-error",
      );
    }
  });
});
