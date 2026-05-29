/**
 * Doctor's knowledge-prompt-disk-consistency section.
 *
 * Verifies that the Knowledge Index bullets rendered into an agent's
 * installed prompt file actually resolve to existing files on disk,
 * that repos/ symlinks are valid, and that manifest entries match disk.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CheckKnowledgeConsistencyInput,
  checkKnowledgeConsistency,
} from "../../../src/core/freshness/check-knowledge-consistency";

interface Ctx {
  root: string;
  agentSmithHome: string;
  opencodeAgentsDir: string;
  claudeAgentsDir: string;
  codexAgentsDir: string;
  kiroAgentsDir: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-kc-"));
  ctx = {
    root,
    agentSmithHome: join(root, "agent-smith-home"),
    opencodeAgentsDir: join(root, "opencode", "agents"),
    claudeAgentsDir: join(root, "claude", "agents"),
    codexAgentsDir: join(root, "codex-skills"),
    kiroAgentsDir: join(root, "kiro", "agents"),
  };
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

function input(agents: string[] = []): CheckKnowledgeConsistencyInput {
  return {
    agentSmithHome: ctx.agentSmithHome,
    installPaths: {
      opencode: ctx.opencodeAgentsDir,
      "claude-code": ctx.claudeAgentsDir,
      codex: ctx.codexAgentsDir,
      kiro: ctx.kiroAgentsDir,
    },
    agents,
  };
}

/** Write a rendered prompt file for an agent at the given platform. */
async function writePrompt(
  agent: string,
  platform: "opencode" | "claude-code" | "codex",
  body: string,
): Promise<void> {
  if (platform === "codex") {
    const dir = join(ctx.codexAgentsDir, agent);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), body);
  } else {
    const dir = platform === "opencode" ? ctx.opencodeAgentsDir : ctx.claudeAgentsDir;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${agent}.md`), body);
  }
}

/** Write a knowledge file at the expected location. */
async function writeKnowledgeFile(agent: string, relPath: string, content = "x"): Promise<void> {
  const dir = join(ctx.agentSmithHome, "knowledge", agent);
  const full = join(dir, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

/** Write a _manifest.json for an agent. */
async function writeManifest(
  agent: string,
  sources: Array<{ id: string; files: Array<{ path: string }> }>,
): Promise<void> {
  const dir = join(ctx.agentSmithHome, "knowledge", agent);
  await mkdir(dir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    renderedAt: new Date().toISOString(),
    sources: sources.map((s) => ({
      id: s.id,
      scope: "agent",
      type: "file",
      delivery: "file",
      files: s.files.map((f) => ({ path: f.path, sha256: "abc", bytes: 100 })),
      tokensInline: 0,
    })),
    totals: { tokensInline: 0, tokensInlineBudget: 50000, files: 0, bytes: 0 },
  };
  await writeFile(join(dir, "_manifest.json"), JSON.stringify(manifest));
}

/** Create a symlink under repos/<id> pointing at target. */
async function writeRepoSymlink(agent: string, id: string, target: string): Promise<void> {
  const reposDir = join(ctx.agentSmithHome, "knowledge", agent, "repos");
  await mkdir(reposDir, { recursive: true });
  await symlink(target, join(reposDir, id));
}

function makePromptWithIndex(bullets: string[]): string {
  return [
    "# Agent",
    "",
    "## Knowledge Index",
    "",
    "Some preamble text.",
    "",
    ...bullets.map((b) => `- ${b}`),
    "",
    "## Other Section",
    "",
    "More content.",
  ].join("\n");
}

describe("checkKnowledgeConsistency", () => {
  test("happy path: all indexed files exist → status=ok", async () => {
    const bullets = [
      "sources/wiki/page1.md",
      "sources/wiki/page2.md",
      "sources/docs/readme.md",
      "sources/docs/guide.md",
      "sources/api/ref.md",
    ];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    for (const b of bullets) await writeKnowledgeFile("myagent", b);
    await writeManifest("myagent", [
      { id: "wiki", files: [{ path: "sources/wiki/page1.md" }, { path: "sources/wiki/page2.md" }] },
    ]);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("ok");
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]!.indexedFiles).toBe(5);
    expect(report.agents[0]!.presentFiles).toBe(5);
    expect(report.agents[0]!.missingFiles).toEqual([]);
    expect(report.agents[0]!.brokenSymlinks).toEqual([]);
    expect(report.agents[0]!.manifestMismatchFiles).toEqual([]);
  });

  test("missing files: 2 of 5 bullets don't resolve → status=drift", async () => {
    const bullets = [
      "sources/wiki/page1.md",
      "sources/wiki/page2.md",
      "sources/wiki/page3.md",
      "sources/docs/readme.md",
      "sources/docs/guide.md",
    ];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    // Only write 3 of 5
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    await writeKnowledgeFile("myagent", "sources/wiki/page2.md");
    await writeKnowledgeFile("myagent", "sources/docs/readme.md");
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("drift");
    expect(report.agents[0]!.indexedFiles).toBe(5);
    expect(report.agents[0]!.presentFiles).toBe(3);
    expect(report.agents[0]!.missingFiles).toHaveLength(2);
    expect(report.agents[0]!.missingFiles).toContain("sources/wiki/page3.md");
    expect(report.agents[0]!.missingFiles).toContain("sources/docs/guide.md");
    expect(report.agents[0]!.fix).toBe("smith knowledge fetch myagent");
  });

  test("broken symlink: repos/<id> symlink target missing → status=drift", async () => {
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    // Create a symlink pointing at a non-existent target
    await writeRepoSymlink("myagent", "my-repo", "/nonexistent/path/to/repo");
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("drift");
    expect(report.agents[0]!.brokenSymlinks).toContain("repos/my-repo");
  });

  test("manifest mismatch: manifest claims file that doesn't exist → status=drift", async () => {
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    // Manifest claims a file that doesn't exist on disk
    await writeManifest("myagent", [
      { id: "wiki", files: [{ path: "sources/wiki/page1.md" }, { path: "sources/wiki/gone.md" }] },
    ]);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("drift");
    expect(report.agents[0]!.manifestMismatchFiles).toContain("sources/wiki/gone.md");
  });

  test("no agents → status=skipped", async () => {
    const report = await checkKnowledgeConsistency(input([]));
    expect(report.status).toBe("skipped");
    expect(report.agents).toEqual([]);
  });

  test("prompt missing entirely: agent not installed for that target → skip gracefully", async () => {
    // Agent listed but no prompt file exists for opencode
    const report = await checkKnowledgeConsistency(input(["ghost"]));
    // Should not error; agent just has no reports
    expect(report.status).toBe("skipped");
    expect(report.agents).toEqual([]);
  });

  test("knowledge dir missing: prompt exists with bullets but knowledgeDir gone → all missing (drift)", async () => {
    const bullets = ["sources/wiki/page1.md", "sources/wiki/page2.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    // Don't create the knowledge dir at all

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("drift");
    expect(report.agents[0]!.indexedFiles).toBe(2);
    expect(report.agents[0]!.presentFiles).toBe(0);
    expect(report.agents[0]!.missingFiles).toHaveLength(2);
  });

  test("multi-platform: same agent installed on multiple targets", async () => {
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    await writePrompt("myagent", "claude-code", makePromptWithIndex(bullets));
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("ok");
    // Should have reports for both platforms
    expect(report.agents).toHaveLength(2);
    expect(report.agents.map((a) => a.target).sort()).toEqual(["claude-code", "opencode"]);
  });

  test("bullets with description suffix are parsed correctly", async () => {
    // Format: `- sources/wiki/page1.md — Some description`
    const body = [
      "## Knowledge Index",
      "",
      "Preamble.",
      "",
      "- sources/wiki/page1.md — A wiki page",
      "- sources/docs/guide.md — The guide",
      "",
    ].join("\n");
    await writePrompt("myagent", "opencode", body);
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    // guide.md missing
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("drift");
    expect(report.agents[0]!.indexedFiles).toBe(2);
    expect(report.agents[0]!.presentFiles).toBe(1);
    expect(report.agents[0]!.missingFiles).toContain("sources/docs/guide.md");
  });

  test("orphan detected: pre-fix refresh-source.ts wrong-path dir exists → orphanTrees includes path", async () => {
    const orphanDir = join(ctx.agentSmithHome, "agents", "agent-a", "knowledge");
    await mkdir(orphanDir, { recursive: true });
    // Agent needs a prompt to avoid skipped status
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("agent-a", "opencode", makePromptWithIndex(bullets));
    await writeKnowledgeFile("agent-a", "sources/wiki/page1.md");
    await writeManifest("agent-a", []);

    const report = await checkKnowledgeConsistency(input(["agent-a"]));
    expect(report.orphanTrees).toContain(orphanDir);
  });

  test("no orphan: wrong-path dir does not exist → orphanTrees is empty", async () => {
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.orphanTrees).toEqual([]);
  });

  test("orphan doesn't affect overall status: orphan present but all files ok → status stays ok", async () => {
    const orphanDir = join(ctx.agentSmithHome, "agents", "myagent", "knowledge");
    await mkdir(orphanDir, { recursive: true });
    const bullets = ["sources/wiki/page1.md"];
    await writePrompt("myagent", "opencode", makePromptWithIndex(bullets));
    await writeKnowledgeFile("myagent", "sources/wiki/page1.md");
    await writeManifest("myagent", []);

    const report = await checkKnowledgeConsistency(input(["myagent"]));
    expect(report.status).toBe("ok");
    expect(report.orphanTrees).toContain(orphanDir);
  });
});
