import { describe, expect, it } from "bun:test";
import type {
  EffectiveDelivery,
  KnowledgeBlock,
  KnowledgeDelivery,
  KnowledgeManifest,
  KnowledgeManifestSourceEntry,
  KnowledgeSection,
  KnowledgeSource,
  MaterializedSource,
} from "../../../src/core/knowledge/types";

describe("knowledge types", () => {
  it("KnowledgeSource accepts a minimal file source", () => {
    const s: KnowledgeSource = {
      id: "schema",
      type: "file",
      path: "./db/schema.sql",
      delivery: "inline",
    };
    expect(s.type).toBe("file");
  });

  it("KnowledgeBlock allows sources without packs", () => {
    const b: KnowledgeBlock = { sources: [] };
    expect(b.sources).toHaveLength(0);
  });

  it("KnowledgeManifest schemaVersion is numeric", () => {
    const m: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: "2026-05-03T00:00:00Z",
      sources: [],
      totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 0, bytes: 0 },
    };
    expect(m.schemaVersion).toBe(1);
  });

  it("KnowledgeSection separates inline and index", () => {
    const k: KnowledgeSection = { inline: [], index: [] };
    expect(k.inline).toEqual([]);
    expect(k.index).toEqual([]);
  });

  it("MaterializedSource carries content and metadata", () => {
    const m: MaterializedSource = {
      id: "x",
      scope: "agent",
      type: "file",
      delivery: "inline",
      files: [{ relPath: "x/index.md", bytes: 10, sha256: "deadbeef", summary: "hi" }],
      tokensInline: 5,
      content: "hi there",
    };
    expect(m.files[0]?.sha256).toBe("deadbeef");
  });
});

describe("KnowledgeDelivery type (input vocabulary)", () => {
  it("accepts inline, file, auto", () => {
    const inline: KnowledgeDelivery = "inline";
    const file: KnowledgeDelivery = "file";
    const auto: KnowledgeDelivery = "auto";
    expect([inline, file, auto]).toEqual(["inline", "file", "auto"]);
  });

  // Type-level assertion: KnowledgeDelivery should NOT include "lazy".
  // This is enforced via the structural-equality drift detector at
  // config-schema.ts:170-180 — if "lazy" leaks in, that assertion fails.
});

describe("EffectiveDelivery type (computed vocabulary)", () => {
  it("accepts the runtime-computed lazy mode", () => {
    const lazy: EffectiveDelivery = "lazy";
    expect(lazy).toBe("lazy");
  });

  it("is a superset of KnowledgeDelivery", () => {
    const inline: EffectiveDelivery = "inline";
    const file: EffectiveDelivery = "file";
    const auto: EffectiveDelivery = "auto";
    expect([inline, file, auto]).toEqual(["inline", "file", "auto"]);
  });
});

describe("KnowledgeManifestSourceEntry", () => {
  it("accepts a lazy entry with a top-level url", () => {
    const entry: KnowledgeManifestSourceEntry = {
      id: "wiki",
      scope: "agent",
      type: "webpage",
      delivery: "lazy",
      url: "https://wiki.internal.example.com/x",
      files: [],
      tokensInline: 0,
    };
    expect(entry.url).toBe("https://wiki.internal.example.com/x");
    expect(entry.delivery).toBe("lazy");
  });

  it("treats url as optional for non-lazy entries", () => {
    const entry: KnowledgeManifestSourceEntry = {
      id: "doc",
      scope: "agent",
      type: "file",
      delivery: "inline",
      files: [{ path: "sources/doc/x.md", sha256: "abc", bytes: 10 }],
      tokensInline: 5,
    };
    expect(entry.url).toBeUndefined();
  });
});
