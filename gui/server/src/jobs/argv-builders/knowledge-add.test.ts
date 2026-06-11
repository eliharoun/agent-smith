import { describe, expect, test } from "bun:test";
import { buildKnowledgeAdd } from "./knowledge-add";

const base = { agent: "t", optional: false, install: false, includeChildren: false };

describe("buildKnowledgeAdd web/mcp", () => {
  test("web crawl flags", () => {
    const { argv } = buildKnowledgeAdd({
      ...base,
      typeOrUrl: "web",
      pathOrUrl: "https://x.com/",
      mode: "crawl",
      maxPagesWeb: 40,
      depth: 3,
      sameOrigin: true,
    } as any);
    expect(argv).toEqual(
      expect.arrayContaining(["web", "https://x.com/", "--mode", "crawl", "--depth", "3"]),
    );
    expect(argv).toContain("--max-pages");
    expect(argv).toContain("40");
  });

  test("mcp flags incl repeated --arg", () => {
    const { argv } = buildKnowledgeAdd({
      ...base,
      typeOrUrl: "mcp",
      server: "notion",
      tool: "search",
      args: { query: "x", scope: "team" },
    } as any);
    expect(argv).toEqual(
      expect.arrayContaining([
        "mcp",
        "--server",
        "notion",
        "--tool",
        "search",
        "--arg",
        "query=x",
        "--arg",
        "scope=team",
      ]),
    );
  });
});
