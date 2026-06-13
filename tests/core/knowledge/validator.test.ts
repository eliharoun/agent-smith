import { describe, expect, it } from "bun:test";
import { validateKnowledge } from "../../../src/core/knowledge/validator";
import type { KnowledgeBlock } from "../../../src/core/knowledge/types";

describe("validateKnowledge", () => {
  it("accepts an empty/undefined block", () => {
    expect(validateKnowledge(undefined)).toEqual({ errors: [], warnings: [] });
    expect(validateKnowledge({})).toEqual({ errors: [], warnings: [] });
  });

  it("accepts git sources (acquire pipeline implements them)", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "g", type: "git", url: "https://example.com/x.git", delivery: "file" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors).toEqual([]);
  });

  it("accepts confluence sources", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "c", type: "confluence", space: "ENG", delivery: "file" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors).toEqual([]);
  });

  it("accepts jira sources", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "j", type: "jira", jql: "project=ENG", delivery: "file" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors).toEqual([]);
  });

  it("rejects npm sources (acquire impl not yet shipped)", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "n", type: "npm", package: "lodash", delivery: "file" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors.some((e) => e.includes("type=npm is not supported"))).toBe(true);
  });

  it("rejects pdf-extract materializer (extractor not yet shipped)", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "p", type: "file", path: "./x.pdf", delivery: "file", materialize: "pdf-extract" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors.some((e) => e.includes("materialize=pdf-extract is not supported"))).toBe(true);
  });

  it("rejects packs (not yet implemented)", () => {
    const r = validateKnowledge({ packs: ["x"] });
    expect(r.errors.some((e) => e.includes("packs are not supported"))).toBe(true);
  });

  it("rejects duplicate source ids", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "x", type: "file", path: "./a.md", delivery: "inline" },
        { id: "x", type: "file", path: "./b.md", delivery: "inline" },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.errors.some((e) => e.toLowerCase().includes("duplicate source id"))).toBe(true);
  });

  it("warns when sum of inlineBudgetTokens exceeds total budget", () => {
    const b: KnowledgeBlock = {
      inlineBudget: { totalTokens: 1000 },
      sources: [
        { id: "a", type: "file", path: "./a.md", delivery: "inline", inlineBudgetTokens: 800 },
        { id: "b", type: "file", path: "./b.md", delivery: "inline", inlineBudgetTokens: 500 },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.warnings.some((w) => w.includes("inline budget"))).toBe(true);
  });

  it("uses 8000 default budget when none declared", () => {
    const b: KnowledgeBlock = {
      sources: [
        { id: "a", type: "file", path: "./a.md", delivery: "inline", inlineBudgetTokens: 9000 },
      ],
    };
    const r = validateKnowledge(b);
    expect(r.warnings.some((w) => w.includes("8000"))).toBe(true);
  });

  describe("refresh field — no warnings (CORE-5 regression)", () => {
    it("never emits a warning when refresh is 'never'", () => {
      const b: KnowledgeBlock = {
        sources: [
          { id: "s", type: "webpage", url: "https://example.com/x", delivery: "file", refresh: "never" },
        ],
      };
      const r = validateKnowledge(b);
      expect(r.warnings.some((w) => w.includes("refresh"))).toBe(false);
    });

    it("never emits a warning when refresh is unset", () => {
      const b: KnowledgeBlock = {
        sources: [
          { id: "s", type: "webpage", url: "https://example.com/x", delivery: "file" },
        ],
      };
      const r = validateKnowledge(b);
      expect(r.warnings.some((w) => w.includes("refresh"))).toBe(false);
    });
  });

  describe("refresh modes", () => {
    it("legacy 'never' on remote source produces no warning", () => {
      const result = validateKnowledge({
        sources: [
          { id: "u", type: "webpage", delivery: "file", url: "https://example.com", refresh: "never" },
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("legacy '1h' on remote source produces no warning", () => {
      const result = validateKnowledge({
        sources: [
          { id: "u", type: "webpage", delivery: "file", url: "https://example.com", refresh: "1h" },
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("object { mode: 'session' } on url source is accepted", () => {
      const result = validateKnowledge({
        sources: [
          { id: "u", type: "webpage", delivery: "file", url: "https://example.com", refresh: { mode: "session" } },
        ],
      });
      expect(result.errors).toEqual([]);
    });

    it("object { mode: 'ttl' } without ttl rejected", () => {
      const result = validateKnowledge({
        sources: [
          { id: "u", type: "webpage", delivery: "file", url: "https://example.com", refresh: { mode: "ttl" } },
        ],
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("\n")).toMatch(/ttl/);
    });

    it("object { mode: 'session' } on file source rejected", () => {
      const result = validateKnowledge({
        sources: [
          { id: "f", type: "file", delivery: "file", path: "./local.md", refresh: { mode: "session" } },
        ],
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("\n")).toMatch(/file/);
    });

    it("legacy '1h' on file source rejected (static type cannot use ttl)", () => {
      const result = validateKnowledge({
        sources: [
          { id: "f", type: "file", delivery: "file", path: "./local.md", refresh: "1h" },
        ],
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("\n")).toMatch(/file/);
    });

    it("undefined refresh is fine on any source type", () => {
      const result = validateKnowledge({
        sources: [
          { id: "f", type: "file", delivery: "file", path: "./local.md" },
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("explicit object modes — happy paths and 'always' on static rejected", () => {
      // mode:"install" object form on static type accepted
      expect(
        validateKnowledge({
          sources: [
            { id: "f", type: "file", delivery: "file", path: "./x.md", refresh: { mode: "install" } },
          ],
        }).errors,
      ).toEqual([]);
      // mode:"ttl" with ttl value on remote type accepted
      expect(
        validateKnowledge({
          sources: [
            { id: "u", type: "webpage", delivery: "file", url: "https://e.com", refresh: { mode: "ttl", ttl: "30m" } },
          ],
        }).errors,
      ).toEqual([]);
      // mode:"always" on static type rejected
      expect(
        validateKnowledge({
          sources: [
            { id: "f", type: "file", delivery: "file", path: "./x.md", refresh: { mode: "always" } },
          ],
        }).errors.length,
      ).toBeGreaterThan(0);
    });
  });
});
