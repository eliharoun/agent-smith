import { describe, expect, test } from "bun:test";
import { isArchiveTarget } from "../../src/io/archive-detect";

describe("isArchiveTarget", () => {
  const positives = [
    "/Users/me/foo.smith-bundle.tgz",
    "./foo.smith-bundle.tgz",
    "~/Downloads/foo.smith-bundle.tgz",
    "foo.tgz",
    "https://example.com/foo.smith-bundle.tgz",
    "https://example.com/path/to/foo.tgz?query=1",
  ];
  const negatives = [
    "git@github.com:acme/team-agents.git",
    "https://github.com/acme/team-agents.git",
    "https://github.com/acme/team-agents",
    "ssh://git@host/repo.git",
    "http://example.com/foo.smith-bundle.tgz",
    "foo.gz",
    "foo",
    "",
    // SSH-style URLs whose path ends in .tgz must not be treated as archive targets.
    "git@github.com:acme/team.tgz",
    "git@github.com:acme/team-agents.smith-bundle.tgz",
    "ssh://git@host/repo.tgz",
  ];
  test.each(positives)("matches %s", (s) => expect(isArchiveTarget(s)).toBe(true));
  test.each(negatives)("rejects %s", (s) => expect(isArchiveTarget(s)).toBe(false));
});
