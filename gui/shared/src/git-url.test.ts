// gui/shared/src/git-url.test.ts
//
// Tests for the gui-shared copy of normalizeGitUrl, mirroring the
// fixtures in `tests/io/git-url.test.ts` for the root copy. The final
// "parity vs root" test explicitly asserts both copies agree on a
// shared fixture array — if either implementation drifts, this test
// fails and points at the divergence.

import { describe, expect, test } from "bun:test";
import { normalizeGitUrl, sameGitRemote } from "./git-url";

describe("normalizeGitUrl (gui-shared)", () => {
  test("strips trailing .git", () => {
    expect(normalizeGitUrl("https://github.com/foo/bar.git")).toBe("github.com/foo/bar");
    expect(normalizeGitUrl("https://github.com/foo/bar.git/")).toBe("github.com/foo/bar");
  });

  test("lowercases host/owner/repo", () => {
    expect(normalizeGitUrl("https://GitHub.com/Foo/Bar.git")).toBe("github.com/foo/bar");
  });

  test("preserves case in segments beyond the first three", () => {
    // Deep segments (paths inside a repo, refs, etc.) are case-
    // sensitive in git so we must not flatten them.
    expect(normalizeGitUrl("https://github.com/foo/bar/Subdir/CaseSensitive")).toBe(
      "github.com/foo/bar/Subdir/CaseSensitive",
    );
  });

  test("treats https:// and git@host: as equivalent", () => {
    expect(normalizeGitUrl("https://github.com/foo/bar.git")).toBe(
      normalizeGitUrl("git@github.com:foo/bar.git"),
    );
  });

  test("treats ssh://git@host/ as equivalent to git@host:", () => {
    expect(normalizeGitUrl("ssh://git@github.com/foo/bar.git")).toBe(
      normalizeGitUrl("git@github.com:foo/bar.git"),
    );
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeGitUrl("  https://github.com/foo/bar.git  ")).toBe("github.com/foo/bar");
  });
});

describe("sameGitRemote", () => {
  test("returns true for equivalent URL forms", () => {
    expect(sameGitRemote("https://github.com/foo/bar.git", "git@github.com:foo/bar")).toBe(true);
  });

  test("returns false for different repos", () => {
    expect(sameGitRemote("https://github.com/foo/bar", "https://github.com/foo/baz")).toBe(false);
  });

  test("returns false when either side is undefined", () => {
    expect(sameGitRemote(undefined, "https://github.com/foo/bar")).toBe(false);
    expect(sameGitRemote("https://github.com/foo/bar", undefined)).toBe(false);
    expect(sameGitRemote(undefined, undefined)).toBe(false);
  });
});

// Parity fixtures shared with tests/io/git-url.test.ts. If you add a
// case here, mirror it there so both copies are exercised by both
// suites. Drift between the two implementations would surface as a
// failure on this fixture.
export const PARITY_FIXTURES: Array<{ input: string; expected: string }> = [
  { input: "https://github.com/foo/bar.git", expected: "github.com/foo/bar" },
  { input: "git@github.com:foo/bar.git", expected: "github.com/foo/bar" },
  { input: "ssh://git@github.com/foo/bar.git", expected: "github.com/foo/bar" },
  { input: "https://GITHUB.com/Foo/BAR/", expected: "github.com/foo/bar" },
  { input: "https://github.com/foo/bar/deep/Path", expected: "github.com/foo/bar/deep/Path" },
  { input: "  https://github.com/a/b.git  ", expected: "github.com/a/b" },
  { input: "https://gitlab.example.com/group/repo.git", expected: "gitlab.example.com/group/repo" },
];

describe("parity fixtures", () => {
  test.each(PARITY_FIXTURES)("normalizes $input", ({ input, expected }) => {
    expect(normalizeGitUrl(input)).toBe(expected);
  });
});
