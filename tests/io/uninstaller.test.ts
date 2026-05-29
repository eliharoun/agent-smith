import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeUninstallPath,
  planUninstallPaths,
  removeAllBundles,
  removeBundle,
} from "../../src/io/uninstaller";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
import { fakeBundle } from "../_helpers/fakeBundle";

// Shared knowledge-paths fixture for tests that don't care about the actual
// directory contents (they stub rmDir or rely on ENOENT being silently
// classified as notFound). Using a /tmp-rooted path keeps the path-traversal
// guard happy and avoids any chance of touching a real home directory.
const knowledgePaths = { agentSmithHome: "/tmp/test-as-uninstaller" };

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
};

describe("io/uninstaller computeUninstallPath", () => {
  test("opencode uses bare paths.opencode/<name>.md", () => {
    expect(computeUninstallPath("foo", "opencode", paths)).toBe("/fake/opencode/agents/foo.md");
  });

  test("claude-code uses bare paths['claude-code']/<name>.md", () => {
    expect(computeUninstallPath("foo", "claude-code", paths)).toBe("/fake/claude/agents/foo.md");
  });

  test("codex uses per-agent subdir paths.codex/<name>/SKILL.md", () => {
    expect(computeUninstallPath("foo", "codex", paths)).toBe("/fake/agents/skills/foo/SKILL.md");
  });

  test("kiro uses paths.kiro/<name>.json (NOT .md)", () => {
    // Regression: computeUninstallPath was hardcoded for .md and
    // incorrectly returned <kiro>/foo.md for kiro targets, causing
    // uninstall to silently no-op on the JSON file the translator
    // emits at <kiro>/foo.json. Surfaced during V6 smoke-test;
    // discovered post-Task 2.7 (translator owns relativePath end-to-end
    // but computeUninstallPath kept its own per-target path table).
    expect(computeUninstallPath("foo", "kiro", paths)).toBe("/fake/kiro/agents/foo.json");
  });
});

describe("io/uninstaller planUninstallPaths", () => {
  test("returns empty array for empty bundle list", () => {
    expect(planUninstallPaths([], paths)).toEqual([]);
  });

  test("flattens (bundle x target) into one path per pair, in declaration order", () => {
    const bundles = [
      fakeBundle("alpha", { targets: ["opencode", "codex"] }),
      fakeBundle("beta", { targets: ["claude-code"] }),
    ];
    expect(planUninstallPaths(bundles, paths)).toEqual([
      "/fake/opencode/agents/alpha.md",
      "/fake/agents/skills/alpha/SKILL.md",
      "/fake/claude/agents/beta.md",
    ]);
  });

  test("bundle with empty targets contributes zero paths", () => {
    const bundles = [
      fakeBundle("empty", { targets: [] }),
      fakeBundle("real", { targets: ["opencode"] }),
    ];
    expect(planUninstallPaths(bundles, paths)).toEqual(["/fake/opencode/agents/real.md"]);
  });
});

describe("io/uninstaller removeBundle", () => {
  test("removes all paths declared by the bundle's targets", async () => {
    const calls: string[] = [];
    const fakeRm = async (p: string) => {
      calls.push(p);
    };
    const bundle = fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] });
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(calls).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/claude/agents/foo.md",
      "/fake/agents/skills/foo/SKILL.md",
    ]);
    expect(result.removed).toEqual(calls);
    expect(result.notFound).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("ENOENT goes to notFound, not errors", async () => {
    const fakeRm = async () => {
      const err = new Error("no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };
    const bundle = fakeBundle("foo");
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.removed).toEqual([]);
    expect(result.notFound).toEqual(["/fake/opencode/agents/foo.md"]);
    expect(result.errors).toEqual([]);
  });

  test("non-ENOENT errors go to errors[]", async () => {
    const fakeRm = async () => {
      const err = new Error("permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };
    const bundle = fakeBundle("foo");
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.errors).toEqual([{ path: "/fake/opencode/agents/foo.md", message: "permission denied" }]);
    expect(result.removed).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  test("non-Error throws are coerced to string in errors[].message", async () => {
    const fakeRm = async () => {
      throw "boom"; // non-Error throw
    };
    const bundle = fakeBundle("foo");
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.errors).toEqual([{ path: "/fake/opencode/agents/foo.md", message: "boom" }]);
    expect(result.removed).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  test("continues processing remaining targets after one failure", async () => {
    let count = 0;
    const fakeRm = async (_p: string) => {
      count++;
      if (count === 2) {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      // others succeed
    };
    const bundle = fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] });
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.removed).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/agents/skills/foo/SKILL.md",
    ]);
    expect(result.errors).toEqual([
      { path: "/fake/claude/agents/foo.md", message: "EACCES" },
    ]);
    expect(result.notFound).toEqual([]);
  });

  test("empty targets array yields empty result with no rmFile calls", async () => {
    let calls = 0;
    const fakeRm = async () => {
      calls++;
    };
    const bundle = fakeBundle("foo", { targets: [] });
    const result = await removeBundle(bundle, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(calls).toBe(0);
    expect(result.removed).toEqual([]);
    expect(result.notFound).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("calls removeBundleKnowledge after platform files when knowledgePaths is provided", async () => {
    const order: string[] = [];
    const bundle: AgentBundle = {
      bundlePath: "/tmp/b",
      config: { name: "kb", targets: ["opencode"], description: "x" } as AgentBundle["config"],
      source: { kind: "user-global", rootPath: "/tmp" } as AgentBundle["source"],
      files: { identity: "", expertise: "", soul: "", user: "" },
    };
    const localPaths: InstallPaths = { opencode: "/tmp/oc", "claude-code": "/tmp/cc", codex: "/tmp/cx", kiro: "/tmp/kiro" };
    const localKnowledge = { agentSmithHome: "/tmp/as" };

    const result = await removeBundle(bundle, localPaths, localKnowledge, {
      rmFile: async (p) => {
        order.push(`rmFile:${p}`);
      },
      rmDir: async (p) => {
        order.push(`rmDir:${p}`);
      },
    });

    expect(order).toEqual([
      "rmFile:/tmp/oc/kb.md",
      "rmDir:/tmp/as/knowledge/kb",
    ]);
    expect(result.removed).toContain("/tmp/oc/kb.md");
    expect(result.knowledgeRemoved).toBe(true);
  });

  test("aggregates knowledge removal failure into errors without throwing", async () => {
    const bundle: AgentBundle = {
      bundlePath: "/tmp/b",
      config: { name: "kb-fail", targets: ["opencode"], description: "x" } as AgentBundle["config"],
      source: { kind: "user-global", rootPath: "/tmp" } as AgentBundle["source"],
      files: { identity: "", expertise: "", soul: "", user: "" },
    };
    const localPaths: InstallPaths = { opencode: "/tmp/oc", "claude-code": "/tmp/cc", codex: "/tmp/cx", kiro: "/tmp/kiro" };
    const localKnowledge = { agentSmithHome: "/tmp/as" };

    const result = await removeBundle(bundle, localPaths, localKnowledge, {
      rmFile: async () => {},
      rmDir: async () => {
        throw new Error("knowledge boom");
      },
    });

    expect(result.knowledgeRemoved).toBe(false);
    expect(result.errors.some((e) => e.message.includes("knowledge boom"))).toBe(true);
  });
});

describe("io/uninstaller removeAllBundles", () => {
  test("aggregates results across multiple bundles", async () => {
    const calls: string[] = [];
    const fakeRm = async (p: string) => {
      calls.push(p);
    };
    const bundles = [
      fakeBundle("foo", { targets: ["opencode"] }),
      fakeBundle("bar", { targets: ["claude-code", "codex"] }),
    ];
    const result = await removeAllBundles(bundles, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.removed).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/claude/agents/bar.md",
      "/fake/agents/skills/bar/SKILL.md",
    ]);
    expect(result.notFound).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("empty bundle list returns empty result", async () => {
    const result = await removeAllBundles([], paths, knowledgePaths, { rmFile: async () => {}, rmDir: async () => {} });
    expect(result).toEqual({ removed: [], notFound: [], errors: [], refused: [], knowledgeRemoved: false, knowledgeNotFound: false });
  });

  test("one bundle's failure does not stop the others", async () => {
    let count = 0;
    const fakeRm = async (_p: string) => {
      count++;
      if (count === 1) {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
    };
    const bundles = [
      fakeBundle("foo", { targets: ["opencode"] }),
      fakeBundle("bar", { targets: ["opencode"] }),
    ];
    const result = await removeAllBundles(bundles, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.errors).toEqual([
      { path: "/fake/opencode/agents/foo.md", message: "EACCES" },
    ]);
    expect(result.removed).toEqual(["/fake/opencode/agents/bar.md"]);
    expect(result.notFound).toEqual([]);
  });

  test("accumulates removed, notFound, and errors independently across bundles", async () => {
    // 3 bundles, each producing a different category of result.
    const fakeRm = async (p: string) => {
      if (p.includes("notfound")) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (p.includes("denied")) {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      // success
    };
    const bundles = [
      fakeBundle("ok", { targets: ["opencode"] }),
      fakeBundle("notfound", { targets: ["claude-code"] }),
      fakeBundle("denied", { targets: ["codex"] }),
    ];
    const result = await removeAllBundles(bundles, paths, knowledgePaths, { rmFile: fakeRm, rmDir: async () => {} });
    expect(result.removed).toEqual(["/fake/opencode/agents/ok.md"]);
    expect(result.notFound).toEqual(["/fake/claude/agents/notfound.md"]);
    expect(result.errors).toEqual([
      { path: "/fake/agents/skills/denied/SKILL.md", message: "EACCES" },
    ]);
  });
});

describe("io/uninstaller defaultRmFile (integration)", () => {
  let root: string;
  let realPaths: InstallPaths;
  let realKnowledge: { agentSmithHome: string };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "smith-uninst-"));
    realPaths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    // Knowledge home lives under the same tmp root. We deliberately do NOT
    // create knowledge/<name>/ — the production rm() should ENOENT and the
    // result is `knowledgeNotFound: true` (silently classified, not an error).
    realKnowledge = { agentSmithHome: join(root, "agent-smith") };
    await mkdir(realPaths.opencode, { recursive: true });
    await mkdir(realPaths["claude-code"], { recursive: true });
    await mkdir(join(realPaths.codex, "demo"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("removeBundle with no deps removes real files via defaultRmFile", async () => {
    // Plant the files removeBundle expects to find.
    await writeFile(join(realPaths.opencode, "demo.md"), "frontmatter\n");
    await writeFile(join(realPaths["claude-code"], "demo.md"), "frontmatter\n");
    await writeFile(join(realPaths.codex, "demo", "SKILL.md"), "frontmatter\n");

    const bundle = fakeBundle("demo", { targets: ["opencode", "claude-code", "codex"] });
    // No deps argument — exercises the production defaultRmFile arrow.
    const result = await removeBundle(bundle, realPaths, realKnowledge);

    expect(result.errors).toEqual([]);
    expect(result.notFound).toEqual([]);
    expect(result.removed.sort()).toEqual([
      join(realPaths.codex, "demo", "SKILL.md"),
      join(realPaths["claude-code"], "demo.md"),
      join(realPaths.opencode, "demo.md"),
    ].sort());

    // Verify the files are actually gone on disk: a re-run of removeBundle
    // should report all three paths as notFound (defaultRmFile uses `rm`
    // with no options, so ENOENT propagates and gets categorised).
    const rerun = await removeBundle(bundle, realPaths, realKnowledge);
    expect(rerun.removed).toEqual([]);
    expect(rerun.errors).toEqual([]);
    expect(rerun.notFound.sort()).toEqual([
      join(realPaths.codex, "demo", "SKILL.md"),
      join(realPaths["claude-code"], "demo.md"),
      join(realPaths.opencode, "demo.md"),
    ].sort());
  });

  test("removeBundle removes empty codex wrapper dir after SKILL.md is gone", async () => {
    await writeFile(join(realPaths.codex, "demo", "SKILL.md"), "frontmatter\n");
    const bundle = fakeBundle("demo", { targets: ["codex"] });

    const result = await removeBundle(bundle, realPaths, realKnowledge);

    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([join(realPaths.codex, "demo", "SKILL.md")]);
    const dirGone = await stat(join(realPaths.codex, "demo")).then(
      () => false,
      () => true,
    );
    expect(dirGone).toBe(true);
  });

  test("removeBundle preserves codex wrapper dir if user added extra files", async () => {
    await writeFile(join(realPaths.codex, "demo", "SKILL.md"), "frontmatter\n");
    await writeFile(join(realPaths.codex, "demo", "user-notes.md"), "my private notes\n");
    const bundle = fakeBundle("demo", { targets: ["codex"] });

    const result = await removeBundle(bundle, realPaths, realKnowledge);

    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([join(realPaths.codex, "demo", "SKILL.md")]);
    // ENOTEMPTY swallowed by rmDirIfEmpty; user files MUST survive uninstall.
    const notes = await readFile(join(realPaths.codex, "demo", "user-notes.md"), "utf8");
    expect(notes).toBe("my private notes\n");
  });
});

// Task 1.4: manifest-aware removeBundle. Hash-mismatch refusal, --force
// override, manifest entry cleanup. Uses real installRendered to seed the
// manifest + on-disk file, then exercises removeBundle.
describe("io/uninstaller manifest-aware removeBundle", () => {
  let homeDir: string;
  let installRoot: string;
  let realKnowledge: { agentSmithHome: string };
  let realPaths: InstallPaths;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "smith-un-mfst-"));
    installRoot = await mkdtemp(join(tmpdir(), "smith-un-mfst-target-"));
    realKnowledge = { agentSmithHome: homeDir };
    realPaths = {
      opencode: join(installRoot, "opencode/agents"),
      "claude-code": join(installRoot, "claude/agents"),
      codex: join(installRoot, "agents/skills"),
      kiro: join(installRoot, "kiro/agents"),
    };
  });
  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(installRoot, { recursive: true, force: true });
  });

  async function seedInstall(name: string): Promise<{ path: string }> {
    const { installRendered } = await import("../../src/io/installer");
    const r = {
      target: "opencode" as const,
      format: "markdown-frontmatter" as const,
      relativePath: `${name}.md`,
      frontmatter: { description: "x" },
      body: "BODY",
    };
    await installRendered([r], realPaths, { homeDir });
    return { path: join(realPaths.opencode, `${name}.md`) };
  }

  test("happy path: deletes file, removes manifest entry, no refusals", async () => {
    const seeded = await seedInstall("happy");
    const { loadInstalledAgents } = await import("../../src/io/installed-agents");

    const result = await removeBundle(
      fakeBundle("happy", { targets: ["opencode"] }),
      realPaths,
      realKnowledge,
      { homeDir },
    );

    expect(result.refused).toEqual([]);
    expect(result.removed).toContain(seeded.path);
    expect(result.errors).toEqual([]);
    await expect(stat(seeded.path)).rejects.toThrow();
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "happy")).toBeUndefined();
  });

  test("hash-mismatch: refuses without --force; file + manifest preserved", async () => {
    const seeded = await seedInstall("drift");
    await writeFile(seeded.path, "modified by another tool\n");
    const { loadInstalledAgents } = await import("../../src/io/installed-agents");

    const result = await removeBundle(
      fakeBundle("drift", { targets: ["opencode"] }),
      realPaths,
      realKnowledge,
      { homeDir },
    );

    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.path).toBe(seeded.path);
    expect(result.refused[0]?.reason).toBe("external-modification");
    expect(result.refused[0]?.suggestedCommand).toContain("--force");
    expect(result.removed).toEqual([]);
    // File still on disk
    expect((await readFile(seeded.path, "utf8"))).toBe("modified by another tool\n");
    // Manifest entry preserved
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "drift")).toBeDefined();
  });

  test("hash-mismatch with --force: deletes file and clears manifest entry", async () => {
    const seeded = await seedInstall("drift-force");
    await writeFile(seeded.path, "modified by another tool\n");
    const { loadInstalledAgents } = await import("../../src/io/installed-agents");

    const result = await removeBundle(
      fakeBundle("drift-force", { targets: ["opencode"] }),
      realPaths,
      realKnowledge,
      { homeDir, force: true },
    );

    expect(result.refused).toEqual([]);
    expect(result.removed).toContain(seeded.path);
    await expect(stat(seeded.path)).rejects.toThrow();
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "drift-force")).toBeUndefined();
  });

  test("missing on-disk file: clears manifest entry quietly via notFound bucket", async () => {
    const seeded = await seedInstall("ghost");
    await rm(seeded.path);
    const { loadInstalledAgents } = await import("../../src/io/installed-agents");

    const result = await removeBundle(
      fakeBundle("ghost", { targets: ["opencode"] }),
      realPaths,
      realKnowledge,
      { homeDir },
    );

    expect(result.notFound).toContain(seeded.path);
    expect(result.refused).toEqual([]);
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "ghost")).toBeUndefined();
  });

  test("no manifest entry (smith-unknown file): falls through to legacy rm path", async () => {
    // Pre-existing behavior: removeBundle deletes whatever is at the
    // computed path. With no manifest entry there's nothing to hash-check;
    // uninstall proceeds. The hash-mismatch refusal applies ONLY to files
    // smith installed (i.e. the file IS in the manifest).
    await mkdir(realPaths.opencode, { recursive: true });
    const orphan = join(realPaths.opencode, "orphan.md");
    await writeFile(orphan, "---\nname: foreign\n---\nbody");

    const result = await removeBundle(
      fakeBundle("orphan", { targets: ["opencode"] }),
      realPaths,
      realKnowledge,
      { homeDir },
    );

    expect(result.removed).toContain(orphan);
    expect(result.refused).toEqual([]);
  });

  test("removeAllBundles aggregates refused[] across bundles", async () => {
    const a = await seedInstall("a");
    const b = await seedInstall("b");
    await writeFile(a.path, "mutated\n");
    await writeFile(b.path, "also mutated\n");

    const result = await removeAllBundles(
      [
        fakeBundle("a", { targets: ["opencode"] }),
        fakeBundle("b", { targets: ["opencode"] }),
      ],
      realPaths,
      realKnowledge,
      { homeDir },
    );

    expect(result.refused).toHaveLength(2);
    expect(result.refused.map((r) => r.path).sort()).toEqual([a.path, b.path].sort());
    expect(result.removed).toEqual([]);
  });
});
