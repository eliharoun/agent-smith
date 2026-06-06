import { describe, expect, it } from "vitest";
import { classifySource } from "./classifySource";

describe("classifySource", () => {
  it("returns unknown for empty string", () => {
    expect(classifySource("")).toBe("unknown");
  });

  it("returns unknown for bare word", () => {
    expect(classifySource("team-agents")).toBe("unknown");
  });

  it("returns unknown for relative path without leading dot-slash", () => {
    expect(classifySource("relative/no-leading-slash")).toBe("unknown");
  });

  it("SSH guard: git@host:repo.tgz is git-url, not archive", () => {
    expect(classifySource("git@github.com:acme/repo.tgz")).toBe("git-url");
  });

  it("SSH guard: ssh:// prefix is git-url", () => {
    expect(classifySource("ssh://git@host/repo")).toBe("git-url");
  });

  it("SSH guard: scp-style with no extension is git-url", () => {
    expect(classifySource("git@github.com:acme/repo.git")).toBe("git-url");
  });

  it("extension second: https tgz URL is archive", () => {
    expect(classifySource("https://example.com/foo.tgz")).toBe("archive");
  });

  it("extension second: strips query string before checking extension", () => {
    expect(classifySource("https://example.com/foo.tgz?token=abc")).toBe("archive");
  });

  it("extension second: strips fragment before checking extension", () => {
    expect(classifySource("https://example.com/foo.smith-bundle.tgz#v2")).toBe("archive");
  });

  it("extension second: .smith-bundle.tgz is archive", () => {
    expect(classifySource("https://example.com/foo.smith-bundle.tgz")).toBe("archive");
  });

  it("scheme third: https without archive extension is git-url", () => {
    expect(classifySource("https://github.com/acme/repo")).toBe("git-url");
  });

  it("scheme third: http:// is also git-url", () => {
    expect(classifySource("http://internal/repo")).toBe("git-url");
  });

  it("path-shape: /absolute/path is directory", () => {
    expect(classifySource("/Users/me/work/team-agents")).toBe("directory");
  });

  it("path-shape: ~/path is directory", () => {
    expect(classifySource("~/path")).toBe("directory");
  });

  it("path-shape: ./path is directory", () => {
    expect(classifySource("./path")).toBe("directory");
  });

  it("whitespace is trimmed before classification", () => {
    expect(classifySource("  git@github.com:acme/repo.git  ")).toBe("git-url");
  });
});
