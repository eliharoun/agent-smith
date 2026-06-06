import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalDirectory } from "../../src/io/local-dir-detect";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "isLocalDir-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isLocalDirectory", () => {
  test("returns true for an existing directory", async () => {
    expect(await isLocalDirectory(dir)).toBe(true);
  });

  test("returns false for an existing file", async () => {
    const f = join(dir, "file.txt");
    await writeFile(f, "x");
    expect(await isLocalDirectory(f)).toBe(false);
  });

  test("returns false for a non-existent path", async () => {
    expect(await isLocalDirectory(join(dir, "nope"))).toBe(false);
  });

  test("returns false for git URLs", async () => {
    expect(await isLocalDirectory("git@github.com:acme/repo.git")).toBe(false);
    expect(await isLocalDirectory("ssh://git@host/repo.git")).toBe(false);
    expect(await isLocalDirectory("https://github.com/acme/repo.git")).toBe(false);
  });

  test("returns false for http(s) URLs even if the path resolves locally", async () => {
    expect(await isLocalDirectory("http://example.com")).toBe(false);
    expect(await isLocalDirectory("https://example.com/foo")).toBe(false);
  });

  test("returns false for empty string", async () => {
    expect(await isLocalDirectory("")).toBe(false);
  });
});
