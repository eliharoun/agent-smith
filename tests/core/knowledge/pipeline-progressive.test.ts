import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runKnowledgeStage } from "../../../src/core/knowledge/pipeline";
import { readCompileManifest } from "../../../src/core/knowledge/compile-manifest";

describe("runKnowledgeStage with compile.progressive", () => {
  it("produces a CompiledKnowledge result and writes compile-manifest.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "smith-compile-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const fileA = join(bundleDir, "a.md");
    await writeFile(fileA, "# Heading A\nbody.");

    const result = await runKnowledgeStage(
      {
        sources: [
          { id: "doc-a", type: "file", path: fileA, delivery: "file", description: "Doc A" },
        ],
        compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeDefined();
    expect(result.compiled?.tocStanza).toContain("`doc-a`");
    const persisted = await readCompileManifest(knowledgeDir);
    expect(persisted?.contentHash).toBe(result.compiled?.manifest.contentHash);

    await rm(root, { recursive: true, force: true });
  });

  it("does not produce a CompiledKnowledge when compile is absent (v1 mode)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smith-v1-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const fileA = join(bundleDir, "a.md");
    await writeFile(fileA, "# A\n");

    const result = await runKnowledgeStage(
      { sources: [{ id: "doc-a", type: "file", path: fileA, delivery: "file" }] },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeUndefined();

    await rm(root, { recursive: true, force: true });
  });
});
