import { describe, expect, it } from "bun:test";
import { buildCompileOptionsFromBundle } from "../../../src/core/knowledge/compile-options";
import type { KnowledgeBlock } from "../../../src/core/knowledge/types";

describe("buildCompileOptionsFromBundle", () => {
  it("populates sourceDeclarations from block.sources", () => {
    const block: KnowledgeBlock = {
      sources: [
        { id: "wiki", type: "url", url: "https://example.com/x", delivery: "auto", lazy: true },
        { id: "doc", type: "file", path: "./d.md", delivery: "file" },
      ],
      compile: { progressive: true, tocMaxLines: 200, emitAgentsMd: true },
    };
    const opts = buildCompileOptionsFromBundle(block);
    expect(opts.progressive).toBe(true);
    expect(opts.tocMaxLines).toBe(200);
    expect(opts.emitAgentsMd).toBe(true);
    expect(opts.sourceDeclarations?.["wiki"]).toBe(block.sources![0]!);
    expect(opts.sourceDeclarations?.["doc"]).toBe(block.sources![1]!);
  });

  it("uses defaults for tocMaxLines + emitAgentsMd when block.compile is missing", () => {
    const block: KnowledgeBlock = {
      sources: [{ id: "x", type: "file", path: "./x.md", delivery: "file" }],
    };
    const opts = buildCompileOptionsFromBundle(block);
    expect(opts.progressive).toBe(true);
    expect(opts.tocMaxLines).toBe(150);
    expect(opts.emitAgentsMd).toBe(false);
  });

  it("handles undefined block (returns empty sourceDeclarations + defaults)", () => {
    const opts = buildCompileOptionsFromBundle(undefined);
    expect(opts.progressive).toBe(true);
    expect(opts.tocMaxLines).toBe(150);
    expect(opts.emitAgentsMd).toBe(false);
    expect(Object.keys(opts.sourceDeclarations ?? {})).toEqual([]);
  });

  it("handles block with no sources", () => {
    const block: KnowledgeBlock = { compile: { progressive: true, tocMaxLines: 100, emitAgentsMd: false } };
    const opts = buildCompileOptionsFromBundle(block);
    expect(Object.keys(opts.sourceDeclarations ?? {})).toEqual([]);
    expect(opts.tocMaxLines).toBe(100);
  });
});
