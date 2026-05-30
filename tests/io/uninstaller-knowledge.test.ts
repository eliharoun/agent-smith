import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { planUninstall, removeBundleKnowledge } from "../../src/io/uninstaller";
import type { KnowledgePaths } from "../../src/io/knowledge-paths";
import type { AgentBundle, InstallPaths } from "../../src/core/types";

describe("removeBundleKnowledge", () => {
  let agentSmithHome: string;
  let paths: KnowledgePaths;

  beforeEach(async () => {
    agentSmithHome = join(tmpdir(), `as-uninst-kn-${Math.random().toString(36).slice(2)}`);
    await mkdir(agentSmithHome, { recursive: true });
    paths = { agentSmithHome };
  });

  afterEach(async () => {
    await rm(agentSmithHome, { recursive: true, force: true });
  });

  it("removes an existing knowledge dir, including .cache/", async () => {
    const knowledgeDir = join(agentSmithHome, "knowledge", "bundle-a");
    await mkdir(join(knowledgeDir, ".cache"), { recursive: true });
    await writeFile(join(knowledgeDir, "index.md"), "content");
    await writeFile(join(knowledgeDir, ".cache", "manifest.json"), "{}");

    const result = await removeBundleKnowledge("bundle-a", paths);

    expect(result.removed).toBe(true);
    expect(result.notFound).toBe(false);
    expect(result.error).toBeUndefined();
    const exists = await stat(knowledgeDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("reports notFound when knowledge dir does not exist", async () => {
    const result = await removeBundleKnowledge("absent-bundle", paths);

    expect(result.removed).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("reports an error when rm fails (non-ENOENT)", async () => {
    const result = await removeBundleKnowledge("bundle-x", paths, {
      rmDir: async (p: string) => {
        throw new Error(`mock failure for ${p}`);
      },
    });

    expect(result.removed).toBe(false);
    expect(result.notFound).toBe(false);
    expect(result.error?.message).toContain("mock failure");
    expect(result.error?.path).toContain("knowledge");
    expect(result.error?.path).toContain("bundle-x");
  });

  it("rejects empty bundle name without touching disk", async () => {
    let called = false;
    const result = await removeBundleKnowledge("", paths, {
      rmDir: async () => {
        called = true;
      },
    });

    expect(called).toBe(false);
    expect(result.removed).toBe(false);
    expect(result.notFound).toBe(false);
    expect(result.error?.path).toBe("");
    expect(result.error?.message).toMatch(/invalid bundle name/);
  });

  it("rejects bundle name with path-traversal characters without touching disk", async () => {
    const dangerous = ["../escape", "with/slash", "with\\backslash", ".dotleading"];
    for (const name of dangerous) {
      let called = false;
      const result = await removeBundleKnowledge(name, paths, {
        rmDir: async () => {
          called = true;
        },
      });

      expect(called).toBe(false);
      expect(result.removed).toBe(false);
      expect(result.notFound).toBe(false);
      expect(result.error?.path).toBe(name);
      expect(result.error?.message).toMatch(/invalid bundle name/);
    }
  });
});

describe("planUninstall: knowledge plan", () => {
  let agentSmithHome: string;
  let knowledgePaths: KnowledgePaths;
  const installPaths: InstallPaths = {
    opencode: "/tmp/oc",
    "claude-code": "/tmp/cc",
    codex: "/tmp/cx",
    kiro: "/tmp/kiro",
  };

  beforeEach(async () => {
    agentSmithHome = join(tmpdir(), `as-plan-kn-${Math.random().toString(36).slice(2)}`);
    await mkdir(agentSmithHome, { recursive: true });
    knowledgePaths = { agentSmithHome };
  });

  afterEach(async () => {
    await rm(agentSmithHome, { recursive: true, force: true });
  });

  function makeBundle(name: string): AgentBundle {
    return {
      bundlePath: `/tmp/${name}`,
      config: {
        name,
        targets: ["opencode"],
        description: "x",
      } as AgentBundle["config"],
      source: { kind: "user-global", rootPath: "/tmp" } as AgentBundle["source"],
      files: { identity: "", expertise: "", soul: "", user: "" },
    };
  }

  it("knowledge.exists is true when dir exists", async () => {
    await mkdir(join(agentSmithHome, "knowledge", "alpha"), { recursive: true });
    const plan = await planUninstall(makeBundle("alpha"), installPaths, knowledgePaths);

    expect(plan.knowledge.bundleName).toBe("alpha");
    expect(plan.knowledge.exists).toBe(true);
    expect(plan.knowledge.knowledgeDir).toBe(join(agentSmithHome, "knowledge", "alpha"));
    expect(plan.knowledge.planError).toBeUndefined();
  });

  it("knowledge.exists is false when dir is absent", async () => {
    const plan = await planUninstall(makeBundle("beta"), installPaths, knowledgePaths);

    expect(plan.knowledge.exists).toBe(false);
    expect(plan.knowledge.planError).toBeUndefined();
  });

  it('knowledge.exists is "unknown" when stat throws non-ENOENT', async () => {
    const plan = await planUninstall(makeBundle("gamma"), installPaths, knowledgePaths, {
      statFn: async () => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
    });

    expect(plan.knowledge.exists).toBe("unknown");
    expect(plan.knowledge.planError).toContain("permission denied");
  });

  it("targets array reflects bundle.config.targets", async () => {
    const bundle = makeBundle("delta");
    const plan = await planUninstall(bundle, installPaths, knowledgePaths);

    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.target).toBe("opencode");
    expect(plan.targets[0]?.path).toBe("/tmp/oc/delta.md");
  });
});
