import { describe, expect, it } from "bun:test";
import { _listPatterns, findRoute } from "../../../src/core/knowledge/routing-registry";

describe("findRoute", () => {
  it("returns null for unknown domain", () => {
    expect(findRoute("https://example.com/x")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(findRoute("not-a-url")).toBeNull();
  });

  it("matches an Atlassian Confluence URL", () => {
    const r = findRoute("https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title");
    expect(r).not.toBeNull();
    expect(r?.server).toMatch(/atlassian/);
  });

  it("matches a GitHub blob URL", () => {
    const r = findRoute("https://github.com/acme/repo/blob/main/README.md");
    expect(r).not.toBeNull();
    expect(r?.server).toMatch(/github/);
  });

  it("matches a Notion URL", () => {
    const r = findRoute("https://www.notion.so/acme/Title-abc123def4567890abcdef0123456789a");
    expect(r).not.toBeNull();
  });

  it("matches a SharePoint URL", () => {
    const r = findRoute("https://acme.sharepoint.com/sites/Eng/Doc.docx");
    expect(r).not.toBeNull();
  });

  it("each registered pattern carries a non-empty tool name placeholder", () => {
    for (const p of _listPatterns()) {
      expect(p.server.length).toBeGreaterThan(0);
      expect(p.tool.length).toBeGreaterThan(0);
    }
  });

  it("returns deterministic result for identical input", () => {
    const r1 = findRoute("https://github.com/x/y/blob/main/z.md");
    const r2 = findRoute("https://github.com/x/y/blob/main/z.md");
    expect(r1?.server).toBe(r2?.server);
    expect(r1?.tool).toBe(r2?.tool);
  });
});
