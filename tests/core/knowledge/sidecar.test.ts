import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadAndMergeKnowledge } from "../../../src/core/knowledge/sidecar";
import type { FileSource, KnowledgeBlock } from "../../../src/core/knowledge/types";

describe("loadAndMergeKnowledge", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-sidecar-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when no embedded and no sidecar", async () => {
    const r = await loadAndMergeKnowledge(dir, undefined);
    expect(r).toBeUndefined();
  });

  it("returns embedded block when no sidecar", async () => {
    const embedded: KnowledgeBlock = {
      sources: [{ id: "a", type: "file", path: "./a.md", delivery: "inline" }],
    };
    const r = await loadAndMergeKnowledge(dir, embedded);
    expect(r?.sources).toHaveLength(1);
  });

  it("returns sidecar when no embedded", async () => {
    const sidecar: KnowledgeBlock = {
      sources: [{ id: "b", type: "file", path: "./b.md", delivery: "file" }],
    };
    await writeFile(join(dir, "knowledge.json"), JSON.stringify(sidecar));
    const r = await loadAndMergeKnowledge(dir, undefined);
    expect(r?.sources?.[0]?.id).toBe("b");
  });

  it("merges embedded + sidecar; sidecar wins on id collision", async () => {
    const embedded: KnowledgeBlock = {
      inlineBudget: { totalTokens: 5000 },
      sources: [
        { id: "a", type: "file", path: "./from-embedded.md", delivery: "inline" },
        { id: "shared", type: "file", path: "./from-embedded.md", delivery: "inline" },
      ],
    };
    const sidecar: KnowledgeBlock = {
      inlineBudget: { totalTokens: 10000 },
      sources: [
        { id: "shared", type: "file", path: "./from-sidecar.md", delivery: "file" },
        { id: "c", type: "file", path: "./c.md", delivery: "auto" },
      ],
    };
    await writeFile(join(dir, "knowledge.json"), JSON.stringify(sidecar));
    const r = await loadAndMergeKnowledge(dir, embedded);
    expect(r?.inlineBudget?.totalTokens).toBe(10000); // sidecar wins
    const shared = r?.sources?.find((s) => s.id === "shared");
    expect((shared as FileSource | undefined)?.path).toBe("./from-sidecar.md");
    expect(r?.sources?.map((s) => s.id).sort()).toEqual(["a", "c", "shared"]);
  });

  it("rejects invalid sidecar JSON with a SmithError validation-failed payload", async () => {
    await writeFile(join(dir, "knowledge.json"), "not json");
    await expect(loadAndMergeKnowledge(dir, undefined)).rejects.toMatchObject({
      name: "SmithError",
      payload: {
        code: "validation-failed",
        what: "knowledge sidecar",
      },
    });
  });

  it("rejects sidecar that fails schema validation with a SmithError validation-failed payload", async () => {
    await writeFile(join(dir, "knowledge.json"), JSON.stringify({ sources: [{ id: "x" }] }));
    const promise = loadAndMergeKnowledge(dir, undefined);
    await expect(promise).rejects.toMatchObject({
      name: "SmithError",
      payload: {
        code: "validation-failed",
        what: "knowledge sidecar",
      },
    });
    // reasons array carries every schema issue, prefixed with the sidecar path.
    await expect(promise).rejects.toMatchObject({
      payload: {
        reasons: expect.arrayContaining([expect.stringContaining("knowledge.json")]),
      },
    });
  });
});
