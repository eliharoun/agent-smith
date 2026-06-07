import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isProtectedAgent,
  isProtectedCatalog,
  isProtectedSkill,
  refusalMessage,
  PROTECTED_AGENTS,
  PROTECTED_CATALOGS,
  PROTECTED_SKILLS,
  _checkLocalSmithClone,
} from "../../src/core/protected-bundles";

describe("protected lists", () => {
  test("agent-smith is in PROTECTED_AGENTS", () => {
    expect(PROTECTED_AGENTS).toContain("agent-smith");
  });
  test("agent-smith-self is in PROTECTED_CATALOGS", () => {
    expect(PROTECTED_CATALOGS).toContain("agent-smith-self");
  });
  test("the-architect and the-keymaker are in PROTECTED_SKILLS", () => {
    expect(PROTECTED_SKILLS).toContain("the-architect");
    expect(PROTECTED_SKILLS).toContain("the-keymaker");
  });
});

describe("predicates", () => {
  test("isProtectedAgent matches known names case-sensitively", () => {
    expect(isProtectedAgent("agent-smith")).toBe(true);
    expect(isProtectedAgent("Agent-Smith")).toBe(false);
    expect(isProtectedAgent("my-agent")).toBe(false);
  });
  test("isProtectedCatalog matches the synthetic label", () => {
    expect(isProtectedCatalog("agent-smith-self")).toBe(true);
    expect(isProtectedCatalog("user-global")).toBe(false);
  });
  test("isProtectedSkill matches both bundled skills", () => {
    expect(isProtectedSkill("the-architect")).toBe(true);
    expect(isProtectedSkill("the-keymaker")).toBe(true);
    expect(isProtectedSkill("my-skill")).toBe(false);
  });
});

describe("refusalMessage", () => {
  test("includes entity, kind, and the legitimate alternative", () => {
    const msg = refusalMessage({ entity: "agent-smith", kind: "agent", verb: "uninstall" });
    expect(msg).toContain("agent-smith");
    expect(msg).toContain("system");
    expect(msg).toContain("smith update");
  });
  test("for skills, points at the bundled-skill story", () => {
    const msg = refusalMessage({ entity: "the-architect", kind: "skill", verb: "uninstall" });
    expect(msg).toContain("the-architect");
    expect(msg).toContain("smith");
  });
});

describe("_checkLocalSmithClone", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "clone-detect-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("true: .git dir + package.json name 'agent-smith'", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "agent-smith" }));
    await mkdir(join(tmp, ".git"));
    expect(_checkLocalSmithClone(tmp)).toBe(true);
  });

  test("true: .git dir + scoped package.json name '@eliharoun/agent-smith'", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "@eliharoun/agent-smith" }));
    await mkdir(join(tmp, ".git"));
    expect(_checkLocalSmithClone(tmp)).toBe(true);
  });

  test("true: .git as a FILE (git worktree / submodule pointer)", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "agent-smith" }));
    await writeFile(join(tmp, ".git"), "gitdir: /somewhere/.git/worktrees/wt\n");
    expect(_checkLocalSmithClone(tmp)).toBe(true);
  });

  test("false: .git missing (npm-installed layout)", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "@eliharoun/agent-smith" }));
    expect(_checkLocalSmithClone(tmp)).toBe(false);
  });

  test("false: package.json missing", async () => {
    await mkdir(join(tmp, ".git"));
    expect(_checkLocalSmithClone(tmp)).toBe(false);
  });

  test("false: package.json name doesn't match", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "something-else" }));
    await mkdir(join(tmp, ".git"));
    expect(_checkLocalSmithClone(tmp)).toBe(false);
  });

  test("false: repoRoot null", () => {
    expect(_checkLocalSmithClone(null)).toBe(false);
  });
});

describe("WORKSPACE_PKG_NAMES parity", () => {
  test("local copy matches workspace-version.ts (no drift)", () => {
    const src = readFileSync("src/io/workspace-version.ts", "utf8");
    expect(src).toContain('"agent-smith"');
    expect(src).toContain('"@eliharoun/agent-smith"');
  });
});
