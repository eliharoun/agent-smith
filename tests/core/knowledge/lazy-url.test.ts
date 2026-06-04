import { describe, expect, it } from "bun:test";
import {
  isLazyUrlSource,
  lazyDescriptionWarnings,
  lazyTocLine,
} from "../../../src/core/knowledge/lazy-url";
import type { KnowledgeSource } from "../../../src/core/knowledge/types";

const lazySrc: KnowledgeSource = {
  id: "wiki",
  type: "url",
  url: "https://wiki.internal.example.com/architecture",
  lazy: true,
  description: "Platform service architecture wiki. Use when answering deployment or service-boundary questions.",
};

describe("isLazyUrlSource", () => {
  it("returns true for a URL source with lazy: true", () => {
    expect(isLazyUrlSource(lazySrc)).toBe(true);
  });

  it("returns false for a URL source with lazy: false", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: false, delivery: "auto" };
    expect(isLazyUrlSource(eager)).toBe(false);
  });

  it("returns false for a URL source with lazy unset", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", delivery: "auto" };
    expect(isLazyUrlSource(eager)).toBe(false);
  });

  it("returns false for a non-URL source even if it had lazy somehow", () => {
    const file: KnowledgeSource = { id: "x", type: "file", path: "./x", delivery: "inline" };
    expect(isLazyUrlSource(file)).toBe(false);
  });
});

describe("lazyDescriptionWarnings", () => {
  it("returns no warnings for a good description", () => {
    expect(lazyDescriptionWarnings(lazySrc)).toEqual([]);
  });

  it("warns when description is missing", () => {
    const src: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: true };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/description/i);
  });

  it("warns when description is shorter than 30 chars", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x",
      lazy: true,
      description: "short",
    };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/short|30 chars/i);
  });

  it("warns when description starts with first or second person", () => {
    for (const desc of [
      "I help with platform questions.",
      "You can use this for platform questions.",
      "This skill helps with platform questions.",
      "This source contains platform info.",
    ]) {
      const src: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: true, description: desc };
      const warnings = lazyDescriptionWarnings(src);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.match(/third.person|first.person|point of view/i))).toBe(true);
    }
  });

  it("warns when description exceeds 1024 chars", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x",
      lazy: true,
      description: "a".repeat(1025),
    };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.some((w) => w.match(/1024|too long/i))).toBe(true);
  });

  it("returns empty array for non-lazy sources", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", delivery: "auto" };
    expect(lazyDescriptionWarnings(eager)).toEqual([]);
  });
});

describe("lazyTocLine", () => {
  it("renders a basic lazy TOC line with WebFetch hint when no via", () => {
    const line = lazyTocLine(lazySrc);
    expect(line).toMatch(/^- `wiki` \[url, lazy\]/);
    expect(line).toMatch(/Platform service architecture wiki/);
    expect(line).toMatch(/url: https:\/\/wiki.internal.example.com\/architecture/);
    expect(line).toMatch(/fetch via: WebFetch/);
  });

  it("renders MCP routing tool when via is set", () => {
    const src: KnowledgeSource = {
      ...lazySrc,
      via: { server: "internal-mcp", tool: "fetch_page" },
    };
    const line = lazyTocLine(src);
    expect(line).toMatch(/fetch via: internal-mcp\.fetch_page/);
    expect(line).not.toMatch(/WebFetch/);
  });

  it("uses summary when description is absent", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x.test",
      lazy: true,
      summary: "TOC summary line.",
    };
    const line = lazyTocLine(src);
    expect(line).toMatch(/TOC summary line/);
  });

  it("renders without description or summary (degraded but valid)", () => {
    const src: KnowledgeSource = { id: "x", type: "url", url: "https://x.test", lazy: true };
    const line = lazyTocLine(src);
    expect(line).toMatch(/^- `x` \[url, lazy\]/);
    expect(line).toMatch(/url: https:\/\/x.test/);
  });
});
