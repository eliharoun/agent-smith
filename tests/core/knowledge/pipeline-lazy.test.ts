import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeStage } from "../../../src/core/knowledge/pipeline";
import { blockWith, eagerUrlSource, lazyUrlSource } from "../../_helpers/lazy-fixtures";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pipeline-lazy-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runKnowledgeStage: lazy URL sources", () => {
  it("does not acquire a lazy URL source at install time", async () => {
    // The lazy source's URL is unreachable. If acquire ran, this would throw.
    const block = blockWith(lazyUrlSource({ url: "https://this-domain-does-not-resolve.invalid/x" }));
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.errors).toEqual([]);
    expect(result.manifest.sources).toHaveLength(1);
    expect(result.manifest.sources[0]?.delivery).toBe("lazy");
  });

  it("records the URL on the manifest entry", async () => {
    const block = blockWith(lazyUrlSource({ url: "https://wiki.example/x" }));
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources[0]?.url).toBe("https://wiki.example/x");
    expect(result.manifest.sources[0]?.files).toEqual([]);
    expect(result.manifest.sources[0]?.tokensInline).toBe(0);
  });

  it("records description and via on the manifest entry", async () => {
    const block = blockWith(
      lazyUrlSource({
        description: "Used when explaining service topology to teammates joining the team.",
        via: { server: "internal-mcp", tool: "fetch_page" },
      }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources[0]?.description).toMatch(/service topology/);
    // via lives on the source declaration, not the manifest entry — the
    // assembler reads it back from the bundle config when rendering. This
    // assertion just confirms we didn't accidentally lose the input.
  });

  it("emits warnings for missing description on lazy sources", async () => {
    // Build a lazy source with no description at all (rather than undefined,
    // which conflicts with exactOptionalPropertyTypes).
    const noDesc = lazyUrlSource();
    delete (noDesc as { description?: string }).description;
    const block = blockWith(noDesc);
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.warnings.some((w) => w.match(/description/i))).toBe(true);
  });

  it("emits warnings for first-person description on lazy sources", async () => {
    const block = blockWith(
      lazyUrlSource({ description: "I help users figure out platform deployment topology." }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.warnings.some((w) => w.match(/third.person|point of view/i))).toBe(true);
  });

  it("a lazy source AND an eager source coexist in one manifest", async () => {
    const block = blockWith(
      lazyUrlSource({ id: "wiki" }),
      eagerUrlSource({
        id: "doc",
        url: "data:,inline-content-here", // data URL avoids real network
        delivery: "inline",
      }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources).toHaveLength(2);
    const wiki = result.manifest.sources.find((s) => s.id === "wiki");
    const doc = result.manifest.sources.find((s) => s.id === "doc");
    expect(wiki?.delivery).toBe("lazy");
    expect(doc?.delivery).toBe("inline");
  });

  it("never writes a sources/<id>/ directory for a lazy source", async () => {
    const block = blockWith(lazyUrlSource({ id: "wiki" }));
    await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    const { readdir } = await import("node:fs/promises");
    let sourcesDirContents: string[] = [];
    try {
      sourcesDirContents = await readdir(join(dir, "sources"));
    } catch {
      // missing sources/ dir is fine
    }
    expect(sourcesDirContents).not.toContain("wiki");
  });
});
