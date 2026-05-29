import { describe, expect, test } from "bun:test";
import {
  extractProfileFromArgv,
  parseProcCmdline,
} from "../../../src/core/process/ppid-sniff";

describe("extractProfileFromArgv", () => {
  test("extracts --profile <name>", () => {
    expect(extractProfileFromArgv("codex --profile my-agent")).toBe("my-agent");
    expect(
      extractProfileFromArgv("/usr/local/bin/codex --profile foo --verbose"),
    ).toBe("foo");
  });
  test("extracts --profile=<name>", () => {
    expect(extractProfileFromArgv("codex --profile=bar")).toBe("bar");
  });
  test("extracts -p <name> short form", () => {
    expect(extractProfileFromArgv("codex -p quux")).toBe("quux");
  });
  test("returns undefined when no profile flag", () => {
    expect(extractProfileFromArgv("codex --verbose")).toBeUndefined();
    expect(extractProfileFromArgv("codex")).toBeUndefined();
    expect(extractProfileFromArgv("")).toBeUndefined();
  });
  test("returns undefined when not invoking codex", () => {
    expect(extractProfileFromArgv("/usr/bin/zsh --profile foo")).toBeUndefined();
    expect(extractProfileFromArgv("vim --profile bar")).toBeUndefined();
  });
  test("handles quoted args in ps output", () => {
    expect(extractProfileFromArgv('codex "--profile" "name with spaces"')).toBe(
      "name with spaces",
    );
  });
});

describe("parseProcCmdline", () => {
  test("converts NUL-separated cmdline into space-separated string", () => {
    expect(parseProcCmdline("codex\0--profile\0my-agent\0")).toBe(
      "codex --profile my-agent",
    );
  });
  test("handles trailing NUL gracefully", () => {
    expect(parseProcCmdline("codex\0\0")).toBe("codex");
  });
  test("returns empty string for empty input", () => {
    expect(parseProcCmdline("")).toBe("");
  });
});
