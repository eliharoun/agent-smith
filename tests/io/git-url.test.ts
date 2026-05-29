import { describe, expect, test } from "bun:test";
import { normalizeGitUrl, sameGitRemote } from "../../src/io/git-url";
import { deriveRemotePath } from "../../src/io/remote-path";

describe("normalizeGitUrl", () => {
  test("strips trailing .git", () => {
    expect(normalizeGitUrl("https://github.com/o/r.git")).toBe(
      normalizeGitUrl("https://github.com/o/r"),
    );
  });

  test("lowercases host/owner/repo", () => {
    expect(normalizeGitUrl("https://GitHub.com/Owner/Repo")).toBe(
      normalizeGitUrl("https://github.com/owner/repo"),
    );
  });

  test("treats https:// and git@host: as equivalent", () => {
    expect(normalizeGitUrl("https://github.com/o/r")).toBe(normalizeGitUrl("git@github.com:o/r"));
  });

  test("treats ssh://git@host/ as equivalent to git@host:", () => {
    expect(normalizeGitUrl("ssh://git@github.com/o/r")).toBe(normalizeGitUrl("git@github.com:o/r"));
  });

  test("strips trailing slash", () => {
    expect(normalizeGitUrl("https://github.com/o/r/")).toBe(
      normalizeGitUrl("https://github.com/o/r"),
    );
  });
});

describe("sameGitRemote", () => {
  test(".git suffix → match", () => {
    expect(sameGitRemote("https://github.com/o/r", "https://github.com/o/r.git")).toBe(true);
  });

  test("https vs ssh → match", () => {
    expect(sameGitRemote("https://github.com/o/r", "git@github.com:o/r")).toBe(true);
  });

  test("different host → no match", () => {
    expect(sameGitRemote("https://github.com/o/r", "https://gitlab.com/o/r")).toBe(false);
  });

  test("different repo → no match", () => {
    expect(sameGitRemote("https://github.com/o/r", "https://github.com/o/r2")).toBe(false);
  });

  test("undefined inputs → false (no remote can't be 'same as' anything)", () => {
    expect(sameGitRemote(undefined, "https://github.com/o/r")).toBe(false);
    expect(sameGitRemote("https://github.com/o/r", undefined)).toBe(false);
    expect(sameGitRemote(undefined, undefined)).toBe(false);
  });

  test("case-insensitive host/owner/repo", () => {
    expect(sameGitRemote("https://GitHub.com/Owner/Repo", "https://github.com/owner/repo")).toBe(
      true,
    );
  });
});

describe("sameGitRemote vs deriveRemotePath agreement (property)", () => {
  const root = "/tmp/remote-root";
  const pairs: Array<[string, string, boolean]> = [
    ["https://github.com/o/r", "https://github.com/o/r.git", true],
    ["https://github.com/o/r", "git@github.com:o/r", true],
    ["https://github.com/o/r", "ssh://git@github.com/o/r", true],
    ["https://GitHub.com/Owner/Repo", "https://github.com/owner/repo", true],
    ["https://github.com/o/r", "https://gitlab.com/o/r", false],
    ["https://github.com/o/r", "https://github.com/o/r2", false],
  ];

  for (const [a, b, expectedSame] of pairs) {
    test(`${a} vs ${b}`, () => {
      const sgr = sameGitRemote(a, b);
      const drpA = deriveRemotePath(a, root);
      const drpB = deriveRemotePath(b, root);
      const drpSame = drpA === drpB;
      expect(sgr).toBe(expectedSame);
      // The contract: sameGitRemote ⇔ deriveRemotePath produces same dir
      expect(sgr).toBe(drpSame);
    });
  }
});

// Parity fixtures shared with gui/shared/src/git-url.test.ts. If you
// add a case here, mirror it there so both copies are exercised by
// both suites. Drift between the two implementations would surface as
// a failure on this fixture.
const PARITY_FIXTURES: Array<{ input: string; expected: string }> = [
  { input: "https://github.com/foo/bar.git", expected: "github.com/foo/bar" },
  { input: "git@github.com:foo/bar.git", expected: "github.com/foo/bar" },
  { input: "ssh://git@github.com/foo/bar.git", expected: "github.com/foo/bar" },
  { input: "https://GITHUB.com/Foo/BAR/", expected: "github.com/foo/bar" },
  { input: "https://github.com/foo/bar/deep/Path", expected: "github.com/foo/bar/deep/Path" },
  { input: "  https://github.com/a/b.git  ", expected: "github.com/a/b" },
  { input: "https://gitlab.example.com/group/repo.git", expected: "gitlab.example.com/group/repo" },
];

describe("parity fixtures (must match gui/shared/src/git-url.test.ts)", () => {
  test.each(PARITY_FIXTURES)("normalizes $input", ({ input, expected }) => {
    expect(normalizeGitUrl(input)).toBe(expected);
  });
});
