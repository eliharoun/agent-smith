import { describe, expect, it } from "bun:test";
import { compile } from "../../../src/core/knowledge/compile";
import type {
  KnowledgeSource,
  MaterializedSource,
} from "../../../src/core/knowledge/types";

const LAZY_DESCRIPTION =
  "Platform architecture wiki. Use when answering deployment topology questions.";

const lazyMaterialized: MaterializedSource = {
  id: "wiki",
  scope: "agent",
  type: "webpage",
  delivery: "lazy",
  description: LAZY_DESCRIPTION,
  files: [],
  tokensInline: 0,
};

const lazyDeclaration: KnowledgeSource = {
  id: "wiki",
  type: "webpage",
  url: "https://wiki.internal.example.com/architecture",
  lazy: true,
  description: LAZY_DESCRIPTION,
};

const compileOpts = {
  progressive: true,
  tocMaxLines: 150,
  emitAgentsMd: false,
};

describe("compile: lazy URL sources", () => {
  it("renders a lazy URL entry with WebFetch hint when no via", () => {
    const result = compile(
      [lazyMaterialized],
      { ...compileOpts, sourceDeclarations: { wiki: lazyDeclaration } },
      { rootDir: "/tmp/agent/knowledge" },
    );
    const stanza = result.tocStanza;
    expect(stanza).toMatch(/^## Knowledge/m);
    expect(stanza).toMatch(/`wiki` \[webpage, lazy\]/);
    expect(stanza).toMatch(/Platform architecture wiki/);
    expect(stanza).toMatch(/url: https:\/\/wiki.internal.example.com\/architecture/);
    expect(stanza).toMatch(/fetch via: WebFetch/);
  });

  it("renders MCP routing tool when via is set", () => {
    const declWithVia: KnowledgeSource = {
      ...lazyDeclaration,
      via: { server: "internal-mcp", tool: "fetch_page" },
    };
    const result = compile(
      [lazyMaterialized],
      { ...compileOpts, sourceDeclarations: { wiki: declWithVia } },
      { rootDir: "/tmp/agent/knowledge" },
    );
    expect(result.tocStanza).toMatch(/fetch via: internal-mcp\.fetch_page/);
    expect(result.tocStanza).not.toMatch(/fetch via: WebFetch/);
  });

  it("preamble explains [url, lazy] semantics when at least one lazy entry exists", () => {
    const result = compile(
      [lazyMaterialized],
      { ...compileOpts, sourceDeclarations: { wiki: lazyDeclaration } },
      { rootDir: "/tmp/agent/knowledge" },
    );
    expect(result.tocStanza).toMatch(/\[webpage, lazy\][^\n]*entries/i);
    expect(result.tocStanza).toMatch(/fetch via:/);
    expect(result.tocStanza).toMatch(/at runtime/i);
  });

  it("preamble omits the lazy explanation when no lazy entries exist", () => {
    const eagerMat: MaterializedSource = {
      id: "doc",
      scope: "agent",
      type: "webpage",
      delivery: "file",
      files: [{ relPath: "sources/doc/x.md", bytes: 100, sha256: "a" }],
      tokensInline: 0,
      description: "Eager doc.",
    };
    const eagerDecl: KnowledgeSource = {
      id: "doc",
      type: "webpage",
      url: "https://example.com/doc",
      delivery: "file",
    };
    const result = compile(
      [eagerMat],
      { ...compileOpts, sourceDeclarations: { doc: eagerDecl } },
      { rootDir: "/tmp/agent/knowledge" },
    );
    expect(result.tocStanza).not.toMatch(/\[webpage, lazy\][^\n]*entries/i);
  });

  it("includes both lazy and non-lazy entries in the same stanza", () => {
    const eagerMat: MaterializedSource = {
      id: "doc",
      scope: "agent",
      type: "webpage",
      delivery: "file",
      files: [{ relPath: "sources/doc/x.md", bytes: 100, sha256: "a" }],
      tokensInline: 0,
      description: "Eager doc.",
    };
    const eagerDecl: KnowledgeSource = {
      id: "doc",
      type: "webpage",
      url: "https://example.com/doc",
      delivery: "file",
    };
    const result = compile(
      [lazyMaterialized, eagerMat],
      { ...compileOpts, sourceDeclarations: { wiki: lazyDeclaration, doc: eagerDecl } },
      { rootDir: "/tmp/agent/knowledge" },
    );
    expect(result.tocStanza).toMatch(/`wiki` \[webpage, lazy\]/);
    expect(result.tocStanza).toMatch(/`doc` \[webpage\]/);
    expect(result.tocStanza).not.toMatch(/`doc` \[webpage, lazy\]/);
  });
});
