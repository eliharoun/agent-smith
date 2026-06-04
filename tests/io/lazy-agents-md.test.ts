import { describe, expect, it } from "bun:test";
import {
  collectLazyUrlSources,
  renderLazyAgentsMdSection,
} from "../../src/io/lazy-agents-md";
import type { KnowledgeBlock } from "../../src/core/knowledge/types";

const block: KnowledgeBlock = {
  sources: [
    {
      id: "wiki",
      type: "url",
      url: "https://wiki.internal.example.com/architecture",
      lazy: true,
      description: "Architecture wiki. Use when answering deployment topology questions.",
    },
    {
      id: "doc",
      type: "url",
      url: "https://example.com/doc",
      delivery: "auto", // not lazy — should be skipped
    },
  ],
};

describe("collectLazyUrlSources", () => {
  it("returns only the lazy URL sources from a block", () => {
    const lazy = collectLazyUrlSources(block);
    expect(lazy.map((s) => s.id)).toEqual(["wiki"]);
  });

  it("returns [] when no sources are lazy", () => {
    expect(collectLazyUrlSources({ sources: [] })).toEqual([]);
    expect(collectLazyUrlSources(undefined)).toEqual([]);
  });
});

describe("renderLazyAgentsMdSection", () => {
  it("returns undefined when no lazy sources", async () => {
    const result = await renderLazyAgentsMdSection(
      { sources: [] },
      { fetchFn: async () => "ignored" },
    );
    expect(result).toBeUndefined();
  });

  it("renders inline content with > source: ref for small bodies", async () => {
    const result = await renderLazyAgentsMdSection(block, {
      fetchFn: async () => "# Body\n\nShort content.",
    });
    expect(result).toContain("## Lazy URL Sources");
    expect(result).toContain("### wiki");
    expect(result).toContain("Architecture wiki");
    expect(result).toContain("> source: https://wiki.internal.example.com/architecture");
    expect(result).toContain("Short content.");
  });

  it("appends fetch warnings when a URL fails", async () => {
    const fetchFn = async (url: string) => {
      if (url.includes("wiki")) throw new Error("HTTP 401");
      return "ok";
    };
    const result = await renderLazyAgentsMdSection(block, { fetchFn });
    // The section is still emitted, but the wiki entry has a warning placeholder.
    expect(result).toContain("## Lazy URL Sources");
    expect(result).toContain("wiki");
    expect(result).toMatch(/HTTP 401|fetch failed/i);
  });

  it("uses description as the section heading subtitle", async () => {
    const result = await renderLazyAgentsMdSection(block, {
      fetchFn: async () => "Body content here.",
    });
    expect(result).toMatch(/### wiki — Architecture wiki/);
  });

  it("skips non-lazy URL sources", async () => {
    const result = await renderLazyAgentsMdSection(block, {
      fetchFn: async () => "any body",
    });
    expect(result).not.toContain("### doc");
    expect(result).not.toContain("https://example.com/doc");
  });
});
