import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWithin } from "../../src/io/assert-within";
import { SmithError } from "../../src/core/smith-error";

/**
 * Defense-in-depth path containment.
 *
 * `assertWithin(target, root)` resolves both paths to their canonical
 * (symlink-followed) form and throws SmithError(validation-failed) if
 * target is not equal to root or a descendant of it. Used as a
 * belt-and-suspenders check at every filesystem write site whose path
 * is partially derived from user input (agent name, source id, etc.).
 * Even if `assertValidAgentName` somewhere fails to be called, this
 * catches the escape before the IO happens.
 *
 * Resolution rules:
 *   - root MUST exist; if it doesn't, that's a programmer error.
 *   - target MAY NOT exist yet (we're often about to create it).
 *     When it doesn't, walk up to the deepest existing ancestor,
 *     realpath that, then re-append the non-existing tail. This
 *     correctly handles `mkdir -p` and `writeFile` of new files.
 *   - Symlinks are followed in both. A symlink under `root` pointing
 *     outside `root` makes the target NOT within root.
 *
 * Tracked under v1 task B6 (docs/2026-05-22-road-to-v1-checklist.md).
 */
describe("assertWithin", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "assert-within-root-"));
    outside = await mkdtemp(join(tmpdir(), "assert-within-outside-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  describe("accepts paths inside root", () => {
    test("root itself", async () => {
      await assertWithin(root, root);
    });

    test("existing child file", async () => {
      const child = join(root, "child.txt");
      await writeFile(child, "x");
      await assertWithin(child, root);
    });

    test("existing nested directory", async () => {
      const nested = join(root, "a", "b", "c");
      await mkdir(nested, { recursive: true });
      await assertWithin(nested, root);
    });

    test("non-existing descendant (about to be created)", async () => {
      const target = join(root, "not", "yet", "created.txt");
      // Parent doesn't exist either; should walk up to root.
      await assertWithin(target, root);
    });

    test("non-existing direct child", async () => {
      const target = join(root, "newfile.txt");
      await assertWithin(target, root);
    });
  });

  describe("rejects paths outside root", () => {
    test("sibling directory", async () => {
      await expect(assertWithin(outside, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test("parent of root", async () => {
      await expect(assertWithin(tmpdir(), root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test('".." escape via composed path', async () => {
      const escapePath = join(root, "..", "elsewhere");
      await expect(assertWithin(escapePath, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test('multiple ".." segments', async () => {
      const escapePath = join(root, "a", "..", "..", "elsewhere");
      await expect(assertWithin(escapePath, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test("absolute path elsewhere", async () => {
      await expect(assertWithin("/etc/passwd", root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });
  });

  describe("rejects symlink escapes", () => {
    test("symlinked file pointing outside root", async () => {
      const linkPath = join(root, "evil-link");
      const targetOutside = join(outside, "secret.txt");
      await writeFile(targetOutside, "secret");
      await symlink(targetOutside, linkPath);

      await expect(assertWithin(linkPath, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test("symlinked directory pointing outside root", async () => {
      const linkPath = join(root, "evil-dir");
      await symlink(outside, linkPath);

      // The link path itself escapes when followed.
      await expect(assertWithin(linkPath, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });

    test("file under a symlinked-out directory", async () => {
      const linkPath = join(root, "evil-dir");
      await symlink(outside, linkPath);
      const innerTarget = join(linkPath, "file.txt");

      await expect(assertWithin(innerTarget, root)).rejects.toBeInstanceOf(
        SmithError,
      );
    });
  });

  describe("error shape", () => {
    test("throws validation-failed with the offending path in reasons", async () => {
      try {
        await assertWithin(outside, root);
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(SmithError);
        const err = e as SmithError;
        expect(err.payload.code).toBe("validation-failed");
        if (err.payload.code === "validation-failed") {
          expect(err.payload.what).toContain("path");
          expect(err.payload.reasons.join(" ")).toContain(outside);
        }
      }
    });
  });
});
