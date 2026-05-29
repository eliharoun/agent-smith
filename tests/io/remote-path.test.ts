import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveRemotePath, isLikelyGitUrl } from "../../src/io/remote-path";

describe("deriveRemotePath", () => {
  const root = "/tmp/remote";
  test.each([
    ["https://github.com/obra/superpowers.git", "/tmp/remote/github.com/obra/superpowers"],
    ["https://github.com/obra/superpowers", "/tmp/remote/github.com/obra/superpowers"],
    ["git@github.com:obra/superpowers.git", "/tmp/remote/github.com/obra/superpowers"],
    ["ssh://git@ssh.dev:222/owner/repo.git", "/tmp/remote/ssh.dev/owner/repo"],
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

  test("rejects host starting with - (option injection)", () => {
    expect(() => deriveRemotePath("https://-evil/o/r.git", root)).toThrow(/starts with '-'/i);
  });

  test("rejects owner segment starting with -", () => {
    expect(() => deriveRemotePath("https://h.example/-evil/r.git", root)).toThrow(
      /starts with '-'/i,
    );
  });

  test("rejects repo segment starting with -", () => {
    expect(() => deriveRemotePath("https://h.example/o/-evil.git", root)).toThrow(
      /starts with '-'/i,
    );
  });

  test("rejects SSH-form with - prefix on owner", () => {
    expect(() => deriveRemotePath("git@h.example:-evil/r.git", root)).toThrow(/starts with '-'/i);
  });
});

describe("isLikelyGitUrl", () => {
  test.each([
    ["https://github.com/foo/bar", true],
    ["https://github.com/foo/bar.git", true],
    ["git@github.com:foo/bar.git", true],
    ["ssh://git@example.com/foo/bar.git", true],
    ["http://gitlab.local/foo/bar", false],
    ["/local/path", false],
    ["./relative", false],
    ["~/expanded", false],
    ["", false],
  ])("classifies %s as %s", (input, expected) => {
    expect(isLikelyGitUrl(input)).toBe(expected);
  });
});
