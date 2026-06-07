import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import { deriveRemotePath, isLikelyGitUrl } from "../../src/io/remote-path";

describe("deriveRemotePath", () => {
  const root = "/tmp/remote";
  test.each([
    ["https://github.com/obra/superpowers.git", "/tmp/remote/github.com/obra/superpowers"],
    ["https://github.com/obra/superpowers", "/tmp/remote/github.com/obra/superpowers"],
    ["git@github.com:obra/superpowers.git", "/tmp/remote/github.com/obra/superpowers"],
    ["ssh://git@ssh.dev:222/owner/repo.git", "/tmp/remote/ssh.dev/owner/repo"],
    // SSH URLs without a user (e.g. some self-hosted git hosts) and with a non-git user.
    ["ssh://git.example.com/pkg/example-skillset", "/tmp/remote/git.example.com/pkg/example-skillset"],
    ["ssh://user@host.example/owner/repo.git", "/tmp/remote/host.example/owner/repo"],
    ["https://github.com/Obra/SuperPowers.git", "/tmp/remote/github.com/obra/superpowers"],
  ])("derives correct path for %s", (input, expected) => {
    expect(deriveRemotePath(input, root)).toBe(expected);
  });

  test("rejects URLs that would escape the remoteRoot via ..", async () => {
    const dir = await mkdtemp(join(tmpdir(), "remote-path-"));
    try {
      expect(() => deriveRemotePath("https://example.com/../../../etc/passwd", dir)).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects URLs that don't match any known git URL form", () => {
    expect(() => deriveRemotePath("not-a-url", "/tmp/remote")).toThrow(/not a recognized git url/i);
    expect(() => deriveRemotePath("ftp://example.com/repo", "/tmp/remote")).toThrow(
      /not a recognized git url/i,
    );
  });
});

describe("deriveRemotePath security hardening (C4.0.1)", () => {
  const root = "/tmp/remote";

  test("rejects ext:: transport", () => {
    expect(() => deriveRemotePath("ext::sh -c whoami", root)).toThrow(/not a recognized git url/i);
  });

  test("rejects plain http:// transport (use https)", () => {
    expect(() => deriveRemotePath("http://example.com/o/r.git", root)).toThrow(
      /not a recognized git url/i,
    );
  });

  // These now throw a structured SmithError (validation-failed). The headline
  // is "git URL validation failed"; the option-injection detail lives in
  // `payload.reasons`. Assert on the payload so the security contract is
  // explicit and not coupled to headline wording.
  function injectionReason(fn: () => unknown): string {
    try {
      fn();
    } catch (err) {
      const p = (err as SmithError).payload;
      if (p?.code === "validation-failed") return p.reasons.join(" ");
      return (err as Error).message;
    }
    throw new Error("expected deriveRemotePath to throw");
  }

  test("rejects host starting with - (option injection)", () => {
    expect(injectionReason(() => deriveRemotePath("https://-evil/o/r.git", root))).toMatch(
      /starts with '-'/i,
    );
  });

  test("rejects owner segment starting with -", () => {
    expect(injectionReason(() => deriveRemotePath("https://h.example/-evil/r.git", root))).toMatch(
      /starts with '-'/i,
    );
  });

  test("rejects repo segment starting with -", () => {
    expect(injectionReason(() => deriveRemotePath("https://h.example/o/-evil.git", root))).toMatch(
      /starts with '-'/i,
    );
  });

  test("rejects SSH-form with - prefix on owner", () => {
    expect(injectionReason(() => deriveRemotePath("git@h.example:-evil/r.git", root))).toMatch(
      /starts with '-'/i,
    );
  });
});

describe("isLikelyGitUrl", () => {
  test.each([
    ["https://github.com/foo/bar", true],
    ["https://github.com/foo/bar.git", true],
    ["git@github.com:foo/bar.git", true],
    ["ssh://git@example.com/foo/bar.git", true],
    ["ssh://git.example.com/pkg/example-skillset", true],
    ["http://gitlab.local/foo/bar", false],
    ["/local/path", false],
    ["./relative", false],
    ["~/expanded", false],
    ["", false],
  ])("classifies %s as %s", (input, expected) => {
    expect(isLikelyGitUrl(input)).toBe(expected);
  });
});
