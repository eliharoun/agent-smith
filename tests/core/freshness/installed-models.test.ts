import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanInstalledModels } from "../../../src/core/freshness/installed-models";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-installed-models-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("scanInstalledModels", () => {
  test("parses model line from opencode-style frontmatter", async () => {
    const opencodeDir = join(tmp, "opencode/agents");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "agent-smith.md"),
      "---\ndescription: foo\nmodel: github-copilot/claude-opus-4.7\n---\n\nbody",
    );
    const r = await scanInstalledModels({
      opencodeAgentsDir: opencodeDir,
      claudeCodeAgentsDir: join(tmp, "no-claude"),
      codexAgentsDir: join(tmp, "no-codex"),
    });
    expect(r).toEqual([
      { platform: "opencode", agent: "agent-smith", model: "github-copilot/claude-opus-4.7" },
    ]);
  });

  test("returns model: null for files lacking a model line", async () => {
    const opencodeDir = join(tmp, "opencode/agents");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "no-model.md"),
      "---\ndescription: foo\n---\n\nbody",
    );
    const r = await scanInstalledModels({
      opencodeAgentsDir: opencodeDir,
      claudeCodeAgentsDir: join(tmp, "no-claude"),
      codexAgentsDir: join(tmp, "no-codex"),
    });
    expect(r).toEqual([{ platform: "opencode", agent: "no-model", model: null }]);
  });

  test("returns empty array for missing dirs", async () => {
    const r = await scanInstalledModels({
      opencodeAgentsDir: join(tmp, "absent"),
      claudeCodeAgentsDir: join(tmp, "absent"),
      codexAgentsDir: join(tmp, "absent"),
    });
    expect(r).toEqual([]);
  });

  // CORE-20: non-canonical YAML for `model:` should yield null rather than
  // surface garbage like "|" or "" to the doctor command.
  test("returns null when model uses a YAML block-scalar indicator", async () => {
    const opencodeDir = join(tmp, "opencode/agents");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "block-scalar.md"),
      "---\ndescription: foo\nmodel: |\n  github-copilot/claude-opus-4.7\n---\n\nbody",
    );
    const r = await scanInstalledModels({
      opencodeAgentsDir: opencodeDir,
      claudeCodeAgentsDir: join(tmp, "no-claude"),
      codexAgentsDir: join(tmp, "no-codex"),
    });
    expect(r).toEqual([{ platform: "opencode", agent: "block-scalar", model: null }]);
  });

  test("returns null when model value is empty", async () => {
    const opencodeDir = join(tmp, "opencode/agents");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "empty-model.md"),
      "---\ndescription: foo\nmodel: \n---\n\nbody",
    );
    const r = await scanInstalledModels({
      opencodeAgentsDir: opencodeDir,
      claudeCodeAgentsDir: join(tmp, "no-claude"),
      codexAgentsDir: join(tmp, "no-codex"),
    });
    expect(r).toEqual([{ platform: "opencode", agent: "empty-model", model: null }]);
  });

  test("returns null when model uses a YAML flow-sequence", async () => {
    const opencodeDir = join(tmp, "opencode/agents");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "flow-seq.md"),
      "---\ndescription: foo\nmodel: [opus, sonnet]\n---\n\nbody",
    );
    const r = await scanInstalledModels({
      opencodeAgentsDir: opencodeDir,
      claudeCodeAgentsDir: join(tmp, "no-claude"),
      codexAgentsDir: join(tmp, "no-codex"),
    });
    expect(r).toEqual([{ platform: "opencode", agent: "flow-seq", model: null }]);
  });

  test("scans all three platforms", async () => {
    const oc = join(tmp, "oc");
    const cc = join(tmp, "cc");
    const cd = join(tmp, "cd");
    await mkdir(oc, { recursive: true });
    await mkdir(cc, { recursive: true });
    await mkdir(join(cd, "x"), { recursive: true });
    await writeFile(join(oc, "a.md"), "---\nmodel: x/y\n---\nbody");
    await writeFile(join(cc, "a.md"), "---\nmodel: opus\n---\nbody");
    await writeFile(join(cd, "x/SKILL.md"), "---\nname: x\n---\nbody");
    const r = await scanInstalledModels({
      opencodeAgentsDir: oc,
      claudeCodeAgentsDir: cc,
      codexAgentsDir: cd,
    });
    expect(r.find((e) => e.platform === "opencode")?.model).toBe("x/y");
    expect(r.find((e) => e.platform === "claude-code")?.model).toBe("opus");
    expect(r.find((e) => e.platform === "codex")?.model).toBeNull();
  });
});
