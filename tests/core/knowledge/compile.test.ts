import { describe, expect, it } from "bun:test";
import { compile, type CompiledKnowledge } from "../../../src/core/knowledge/compile";
import type { MaterializedSource } from "../../../src/core/knowledge/types";

const baseSource = (overrides: Partial<MaterializedSource>): MaterializedSource => {
  const id = overrides.id ?? "x";
  return {
    id,
    scope: "agent",
    type: "webpage",
    delivery: "file",
    files: [{ relPath: `sources/${id}/index.md`, bytes: 100, sha256: "a".repeat(64) }],
    tokensInline: 0,
    ...overrides,
  };
};

describe("compile", () => {
  it("produces a TOC bullet per source with id, type, summary, and relPath", () => {
    const result = compile(
      [baseSource({ id: "runbook", description: "On-call runbook" })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(result.tocStanza).toContain("- `runbook` [webpage] — On-call runbook → `sources/runbook/index.md`");
  });

  it("uses summary > description > id fallback", () => {
    const explicit = compile(
      [baseSource({ id: "a", description: "ignored", summary: "explicit summary" })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(explicit.tocStanza).toContain("explicit summary");

    const descOnly = compile(
      [baseSource({ id: "b", description: "from description" })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(descOnly.tocStanza).toContain("from description");

    const idOnly = compile(
      [baseSource({ id: "c" })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(idOnly.tocStanza).toContain("- `c` [webpage]");
  });

  it("omits sources with toc=false from the stanza but keeps them in the manifest", () => {
    const result = compile(
      [
        baseSource({ id: "shown" }),
        baseSource({ id: "hidden", toc: false }),
      ],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(result.tocStanza).toContain("`shown`");
    expect(result.tocStanza).not.toContain("`hidden`");
    expect(result.manifest.sources.map((s) => s.id)).toEqual(["shown", "hidden"]);
  });

  it("truncates the TOC at tocMaxLines and warns about dropped ids", () => {
    const sources = Array.from({ length: 10 }, (_, i) => baseSource({ id: `s${i}` }));
    const result = compile(
      sources,
      { progressive: true, tocMaxLines: 5, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    const lines = result.tocStanza.split("\n").filter((l) => l.startsWith("- `"));
    expect(lines.length).toBe(5);
    expect(result.warnings.some((w) => w.includes("s5") && w.includes("dropped"))).toBe(true);
  });

  it("appends a retrieval hint when retrieval.mode != 'off'", () => {
    const result = compile(
      [baseSource({ id: "indexed", retrieval: { mode: "bm25" } })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(result.tocStanza).toMatch(/\(searchable: bm25\)/);
  });

  it("defaults to bm25 retrieval annotation when no retrieval block is set", () => {
    // Sources without an explicit retrieval block now get the (searchable: bm25)
    // annotation by default — matches what `smith knowledge serve` actually does.
    const result = compile(
      [baseSource({ id: "implicit" })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(result.tocStanza).toMatch(/\(searchable: bm25\)/);
  });

  it("omits the retrieval hint when retrieval.mode is explicitly 'off'", () => {
    const result = compile(
      [baseSource({ id: "advisory-off", retrieval: { mode: "off" } })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    // The bullet line for `advisory-off` must not carry an annotation;
    // the preamble's explanation of (searchable: ...) is allowed to mention
    // the word, so we match against the source's bullet line specifically.
    const bullet = result.tocStanza
      .split("\n")
      .find((l) => l.includes("`advisory-off`"));
    expect(bullet).toBeDefined();
    expect(bullet).not.toMatch(/\(searchable:/);
  });

  it("returns a content hash that is stable across calls with identical input", () => {
    const a = compile([baseSource({ id: "x" })], { progressive: true, tocMaxLines: 150, emitAgentsMd: false }, { rootDir: "k" });
    const b = compile([baseSource({ id: "x" })], { progressive: true, tocMaxLines: 150, emitAgentsMd: false }, { rootDir: "k" });
    expect(a.manifest.contentHash).toBe(b.manifest.contentHash);
  });

  it("renders a web source as multi-file (directory path) in the TOC", () => {
    const result = compile(
      [baseSource({
        id: "crawled-site",
        type: "web",
        description: "Crawled docs",
        files: [
          { relPath: "sources/crawled-site/page1.md", bytes: 100, sha256: "a".repeat(64) },
          { relPath: "sources/crawled-site/page2.md", bytes: 200, sha256: "b".repeat(64) },
        ],
      })],
      { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      { rootDir: "knowledge" },
    );
    expect(result.tocStanza).toContain("- `crawled-site` [web] — Crawled docs → `sources/crawled-site/ (2 files)`");
  });
});
