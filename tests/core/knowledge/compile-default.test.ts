import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeStage } from "../../../src/core/knowledge/pipeline";
import { readCompileManifest } from "../../../src/core/knowledge/compile-manifest";

describe("smart compile default", () => {
  it("does NOT compile when total content is below the inline budget (no compile block)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smart-default-small-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const fileA = join(bundleDir, "small.md");
    await writeFile(fileA, "# Small doc\nA few hundred bytes.");

    const result = await runKnowledgeStage(
      { sources: [{ id: "small-doc", type: "file", path: fileA, delivery: "file" }] },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeUndefined();
    expect(await readCompileManifest(knowledgeDir)).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("DOES compile when total content exceeds the inline budget (no compile block)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smart-default-large-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    // 50 KB content ~= 12.5k tokens — well over the 8k default budget.
    const big = "x".repeat(50_000);
    const fileA = join(bundleDir, "large.md");
    await writeFile(fileA, big);

    const result = await runKnowledgeStage(
      { sources: [{ id: "large-doc", type: "file", path: fileA, delivery: "file" }] },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeDefined();
    expect(await readCompileManifest(knowledgeDir)).toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("explicit compile.progressive=false wins over auto (large bundle stays v1)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smart-default-optout-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const big = "x".repeat(50_000);
    const fileA = join(bundleDir, "large.md");
    await writeFile(fileA, big);

    const result = await runKnowledgeStage(
      {
        sources: [{ id: "large-doc", type: "file", path: fileA, delivery: "file" }],
        compile: { progressive: false, tocMaxLines: 150, emitAgentsMd: false },
      },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("explicit compile.progressive=true wins over auto (small bundle still compiles)", async () => {
    const root = await mkdtemp(join(tmpdir(), "smart-default-optin-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const fileA = join(bundleDir, "small.md");
    await writeFile(fileA, "small content");

    const result = await runKnowledgeStage(
      {
        sources: [{ id: "small-doc", type: "file", path: fileA, delivery: "file" }],
        compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("respects custom inlineBudget.totalTokens", async () => {
    // 5 KB content. Default budget would inline (under 8k tokens). With a
    // 100-token custom budget, content is over → should compile.
    const root = await mkdtemp(join(tmpdir(), "smart-default-budget-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const content = "x".repeat(5_000);
    const fileA = join(bundleDir, "mid.md");
    await writeFile(fileA, content);

    const result = await runKnowledgeStage(
      {
        sources: [{ id: "mid-doc", type: "file", path: fileA, delivery: "file" }],
        inlineBudget: { totalTokens: 100 },
      },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("does NOT auto-compile when any source has explicit delivery: 'inline'", async () => {
    // Author intent: a source declared `delivery: "inline"` is the user saying
    // "keep this in working memory regardless." Even if the corpus would
    // otherwise trip the auto-compile heuristic, the bundle stays on the v1
    // path so the validator's hard-limit check surfaces overflow as an error
    // instead of silent flip to compile mode.
    const root = await mkdtemp(join(tmpdir(), "smart-default-explicit-inline-"));
    const bundleDir = join(root, "bundle");
    const knowledgeDir = join(root, "knowledge");
    const cacheDir = join(root, "cache");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    // Big enough to overflow the 8k default budget.
    const big = "x".repeat(50_000);
    const fileA = join(bundleDir, "big.md");
    await writeFile(fileA, big);

    const result = await runKnowledgeStage(
      { sources: [{ id: "big-doc", type: "file", path: fileA, delivery: "inline" }] },
      { bundleDir, knowledgeDir, cacheDir },
    );

    expect(result.compiled).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});
