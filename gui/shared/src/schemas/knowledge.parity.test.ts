import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeSource } from "./knowledge";

const FIXTURES = join(import.meta.dir, "../../test/fixtures/knowledge-sources");

describe("knowledge schema parity with CLI", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
  it.each(files)("accepts fixture %s", (file) => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
    const result = KnowledgeSource.safeParse(raw);
    if (!result.success) {
      throw new Error(`${file}: ${JSON.stringify(result.error.format(), null, 2)}`);
    }
    expect(result.success).toBe(true);
  });
});

describe("via routing parity", () => {
  it("accepts via on a url source", () => {
    const result = KnowledgeSource.safeParse({
      id: "routed-confluence-page",
      type: "url",
      url: "https://example.atlassian.net/wiki/spaces/X/pages/123",
      via: {
        server: "atlassian-mcp",
        tool: "getConfluencePage",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts via with optional args", () => {
    const result = KnowledgeSource.safeParse({
      id: "routed-with-args",
      type: "url",
      url: "https://example.atlassian.net/wiki/spaces/X/pages/123",
      via: {
        server: "atlassian-mcp",
        tool: "getConfluencePage",
        args: { space: "X", pageId: "123" },
        allowWriteTool: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects via with empty server", () => {
    const result = KnowledgeSource.safeParse({
      id: "bad-routing",
      type: "url",
      url: "https://example.atlassian.net/wiki/spaces/X/pages/123",
      via: {
        server: "",
        tool: "getConfluencePage",
      },
    });
    expect(result.success).toBe(false);
  });
});
