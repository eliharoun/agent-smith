import { describe, expect, test } from "bun:test";
import { normalizeGitWebUrl } from "../../src/core/install-from-url";

describe("normalizeGitWebUrl", () => {
  test("strips /tree/<branch> and extracts the branch as ref", () => {
    const r = normalizeGitWebUrl("https://github.com/mattpocock/skills/tree/main");
    expect(r.url).toBe("https://github.com/mattpocock/skills");
    expect(r.ref).toBe("main");
  });

  test("strips /tree/<branch>/<subpath> (the exact repro) incl trailing slash", () => {
    const r = normalizeGitWebUrl("https://github.com/mattpocock/skills/tree/main/skills/");
    expect(r.url).toBe("https://github.com/mattpocock/skills");
    expect(r.ref).toBe("main");
  });

  test("handles a deep subpath after the branch", () => {
    const r = normalizeGitWebUrl("https://github.com/acme/monorepo/tree/develop/packages/agents/x");
    expect(r.url).toBe("https://github.com/acme/monorepo");
    expect(r.ref).toBe("develop");
  });

  test("handles /blob/<branch>/<file> (file view) URLs", () => {
    const r = normalizeGitWebUrl("https://github.com/acme/repo/blob/v1.2.3/README.md");
    expect(r.url).toBe("https://github.com/acme/repo");
    expect(r.ref).toBe("v1.2.3");
  });

  test("leaves a clean repo URL unchanged with no ref", () => {
    const r = normalizeGitWebUrl("https://github.com/acme/repo");
    expect(r.url).toBe("https://github.com/acme/repo");
    expect(r.ref).toBeUndefined();
  });

  test("leaves a .git URL unchanged", () => {
    const r = normalizeGitWebUrl("https://github.com/acme/repo.git");
    expect(r.url).toBe("https://github.com/acme/repo.git");
    expect(r.ref).toBeUndefined();
  });

  test("leaves SSH and file URLs unchanged (no /tree/ shape)", () => {
    expect(normalizeGitWebUrl("git@github.com:acme/repo.git").ref).toBeUndefined();
    expect(normalizeGitWebUrl("file:///tmp/repo").ref).toBeUndefined();
  });

  test("works for non-github hosts with the same /tree/ convention (e.g. gitea)", () => {
    const r = normalizeGitWebUrl("https://gitea.example.com/team/repo/tree/main/sub");
    expect(r.url).toBe("https://gitea.example.com/team/repo");
    expect(r.ref).toBe("main");
  });
});
