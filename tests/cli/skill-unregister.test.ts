import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillRegister } from "../../src/cli/commands/skill/register";
import { skillUnregister } from "../../src/cli/commands/skill/unregister";
import { SmithError } from "../../src/core/smith-error";
import { loadSkillRegistry } from "../../src/io/skill-registry";

let dir: string;
let registryPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-unreg-"));
  registryPath = join(dir, "skill-catalogs.json");
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli/skill unregister", () => {
  test("removes a registered catalog by label, exit 0", async () => {
    const target = join(dir, "u1");
    await mkdir(target, { recursive: true });
    await skillRegister(target, {
      kind: "user-global",
      label: "by-label",
      registryPath,
      allowEmpty: true,
    });
    const code = await skillUnregister("by-label", { registryPath });
    expect(code).toBe(0);
    const reg = await loadSkillRegistry(registryPath);
    expect(reg.catalogs.some((c) => c.label === "by-label")).toBe(false);
  });

  test("removes a registered catalog by rootPath, exit 0", async () => {
    const target = join(dir, "u2");
    await mkdir(target, { recursive: true });
    await skillRegister(target, { kind: "user-global", registryPath, allowEmpty: true });
    const code = await skillUnregister(target, { registryPath });
    expect(code).toBe(0);
    const reg = await loadSkillRegistry(registryPath);
    expect(reg.catalogs.some((c) => c.rootPath === target)).toBe(false);
  });

  test("throws SmithError(not-found) when no match", async () => {
    const err = await skillUnregister("nonexistent-label", { registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.identifier).toBe("nonexistent-label");
  });

  test("input starting with '/' is treated as an absolute path", async () => {
    const target = join(dir, "u-abs");
    await mkdir(target, { recursive: true });
    await skillRegister(target, { kind: "user-global", registryPath, allowEmpty: true });
    const code = await skillUnregister(target, { registryPath });
    expect(code).toBe(0);
  });

  test("input starting with './' is treated as a relative path and resolved", async () => {
    // Use process.cwd() after chdir to derive the realpath-canonical
    // version of the temp dir (macOS symlinks /tmp -> /private/tmp), so the
    // absolute path written into the registry matches what
    // skillUnregister will compute via resolve("./skills-rel").
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const realDir = process.cwd();
      const sub = join(realDir, "skills-rel");
      await mkdir(sub, { recursive: true });
      await skillRegister(sub, {
        kind: "user-global",
        label: "rel-cat",
        registryPath,
        allowEmpty: true,
      });
      const code = await skillUnregister("./skills-rel", { registryPath });
      expect(code).toBe(0);
      const reg = await loadSkillRegistry(registryPath);
      expect(reg.catalogs.some((c) => c.rootPath === sub)).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });

  test("not-found SmithError clarifies whether the lookup was by path or label", async () => {
    const labelErr = await skillUnregister("nope-label", { registryPath }).catch((e) => e);
    expect(labelErr).toBeInstanceOf(SmithError);
    expect(labelErr.payload.what).toMatch(/looked up by label/i);
    expect(labelErr.payload.identifier).toBe("nope-label");

    const pathErr = await skillUnregister("/tmp/nope-path", { registryPath }).catch((e) => e);
    expect(pathErr).toBeInstanceOf(SmithError);
    expect(pathErr.payload.what).toMatch(/looked up by path/i);
    expect(pathErr.payload.identifier).toBe("/tmp/nope-path");
  });

  test("[DW-8] accepts a label containing '/' (e.g. 'owner/repo' shape)", async () => {
    // Mirror of agent-side DW-8 regression: remote-installed skill catalogs
    // get auto-derived labels like 'owner/repo'. Pre-fix, the looksLikePath
    // heuristic routed those to the path branch and never tried a label
    // lookup, breaking 'smith skill unregister owner/repo'.
    const skillsRoot = join(dir, "skills-remote");
    await mkdir(join(skillsRoot, "some-skill"), { recursive: true });
    await Bun.write(join(skillsRoot, "some-skill", "SKILL.md"), "# skill");
    await skillRegister(skillsRoot, { kind: "team-shared", label: "owner/repo", registryPath });

    const code = await skillUnregister("owner/repo", { registryPath });
    expect(code).toBe(0);
    const reread = await loadSkillRegistry(registryPath);
    expect(reread.catalogs.some((c) => c.label === "owner/repo")).toBe(false);
  });
});
