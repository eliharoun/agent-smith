import { describe, expect, it } from "bun:test";
import type {
  KnowledgeBlock,
  KnowledgeDelivery,
  KnowledgeManifest,
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

describe("KnowledgeDelivery type", () => {
  it("includes lazy as a valid value", () => {
    const v: KnowledgeDelivery = "lazy";
    expect(v).toBe("lazy");
  });

  it("includes the existing values", () => {
    const inline: KnowledgeDelivery = "inline";
    const file: KnowledgeDelivery = "file";
    const auto: KnowledgeDelivery = "auto";
    expect([inline, file, auto]).toEqual(["inline", "file", "auto"]);
  });
});
