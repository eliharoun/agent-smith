import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillRegister } from "../../src/cli/commands/skill/register";
import { SmithError } from "../../src/core/smith-error";
import { loadSkillRegistry } from "../../src/io/skill-registry";

let dir: string;
let registryPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-reg-cli-"));
  registryPath = join(dir, "skill-catalogs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli/skill register", () => {
  test("adds a new catalog with kind=user-global — appears in loaded registry", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const target = join(dir, "skills-a");
    await mkdir(target, { recursive: true });
    await skillRegister(target, { kind: "user-global", registryPath, allowEmpty: true });
    const reg = await loadSkillRegistry(registryPath);
    expect(reg.catalogs.some((c) => c.rootPath === target)).toBe(true);
  });

  test("normalizes relative paths to absolute (mirrors agent register)", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    // Use a relative path resolvable to an existing dir under `dir`. chdir
    // briefly so resolve("./relative-skills") points there.
    const target = join(dir, "relative-skills");
    await mkdir(target, { recursive: true });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await skillRegister("./relative-skills", {
        kind: "user-local",
        registryPath,
        allowEmpty: true,
      });
    } finally {
      process.chdir(cwd);
    }
    const reg = await loadSkillRegistry(registryPath);
    const added = reg.catalogs.find((c) => c.kind === "user-local");
    expect(added?.rootPath.startsWith("/")).toBe(true);
  });

  test("defaults label to '<kind>:<absPath>' when --label omitted", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const target = join(dir, "x");
    await mkdir(target, { recursive: true });
    await skillRegister(target, { kind: "team-shared", registryPath, allowEmpty: true });
    const reg = await loadSkillRegistry(registryPath);
    const found = reg.catalogs.find((c) => c.rootPath === target);
    expect(found?.label).toBe(`team-shared:${target}`);
  });

  test("stores --label and --git-remote when provided", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const target = join(dir, "y");
    await mkdir(target, { recursive: true });
    await skillRegister(target, {
      kind: "team-shared",
      label: "shared-team",
      gitRemote: "https://example.com/team.git",
      registryPath,
      allowEmpty: true,
      skipGitCheck: true,
    });
    const reg = await loadSkillRegistry(registryPath);
    const found = reg.catalogs.find((c) => c.label === "shared-team");
    expect(found?.gitRemote).toBe("https://example.com/team.git");
  });

  test("is silent (idempotent) when an identical catalog already exists", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const target = join(dir, "dup");
    await mkdir(target, { recursive: true });
    await skillRegister(target, { kind: "user-global", registryPath, allowEmpty: true });
    await skillRegister(target, { kind: "user-global", registryPath, allowEmpty: true });
    const reg = await loadSkillRegistry(registryPath);
    expect(reg.catalogs.filter((c) => c.rootPath === target)).toHaveLength(1);
  });

  test("throws with clear error when label collides with existing catalog", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const t1 = join(dir, "p1");
    const t2 = join(dir, "p2");
    await mkdir(t1, { recursive: true });
    await mkdir(t2, { recursive: true });
    await skillRegister(t1, {
      kind: "user-global",
      label: "conflict",
      registryPath,
      allowEmpty: true,
    });
    await expect(
      skillRegister(t2, {
        kind: "user-local",
        label: "conflict",
        registryPath,
        allowEmpty: true,
      }),
    ).rejects.toThrow(/conflict/i);
  });
});

describe("smith skill register — validation (followup #15-adj)", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-skill-register-test-"));
    registryPath = join(dir, "skill-catalogs.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("rejects nonexistent path", async () => {
    const missing = join(dir, "nope");
    const err = await skillRegister(missing, { kind: "user-local", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("skill catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("does not exist"))).toBe(true);
  });

  test("rejects path that looks like an agent source and points at smith agent register", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");
    const err = await skillRegister(target, { kind: "user-local", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("skill catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("smith agent register"))).toBe(true);
    expect(err.payload.suggestedCommand).toContain("smith agent register");
  });

  test("rejects empty path without --allow-empty", async () => {
    const target = join(dir, "empty");
    await mkdir(target, { recursive: true });
    const err = await skillRegister(target, { kind: "user-local", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("skill catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("no skills"))).toBe(true);
    expect(err.payload.suggestedCommand).toContain("--allow-empty");
  });

  test("accepts empty path with --allow-empty", async () => {
    const target = join(dir, "empty");
    await mkdir(target, { recursive: true });
    await skillRegister(target, {
      kind: "user-local",
      registryPath,
      allowEmpty: true,
    });
    expect(true).toBe(true);
  });

  test("--git-remote URL mismatch is rejected", async () => {
    const target = join(dir, "skills");
    await mkdir(join(target, "skill-a"), { recursive: true });
    await writeFile(join(target, "skill-a/SKILL.md"), "# x");
    const fakeRunGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/fake";
      if (args[0] === "remote") return "origin\thttps://example.com/other.git (fetch)";
      throw new Error("unreachable");
    };
    const err = await skillRegister(target, {
      kind: "user-local",
      registryPath,
      gitRemote: "https://example.com/foo.git",
      runGit: fakeRunGit,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("skill catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("does not match any remote"))).toBe(
      true,
    );
  });
});
