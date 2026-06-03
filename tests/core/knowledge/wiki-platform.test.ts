import { describe, expect, it } from "bun:test";
import { detectWikiPlatform } from "../../../src/core/knowledge/wiki-platform";

describe("detectWikiPlatform", () => {
  it("detects XWiki by xwikicontent class", () => {
    const html = '<html><body><div class="xwikicontent">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("xwiki");
  });

  it("detects XWiki by generator meta tag", () => {
    const html = '<html><head><meta name="generator" content="XWiki 14.10"></head><body>x</body></html>';
    expect(detectWikiPlatform(html)).toBe("xwiki");
  });

  it("detects Confluence by main-content + aui-page-panel", () => {
    const html = '<html><body><div id="main-content" class="aui-page-panel">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("confluence");
  });

  it("detects Confluence by confluence-content id", () => {
    const html = '<html><body><div id="confluence-content">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("confluence");
  });

  it("detects MediaWiki by mw-parser-output", () => {
    const html = '<html><body><div class="mw-parser-output">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("mediawiki");
  });

  it("detects MediaWiki by generator meta tag", () => {
    const html = '<html><head><meta name="generator" content="MediaWiki 1.41"></head><body>x</body></html>';
    expect(detectWikiPlatform(html)).toBe("mediawiki");
  });

  it("detects SharePoint by ms-rtestate-field", () => {
    const html = '<html><body><div class="ms-rtestate-field">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("sharepoint");
  });

  it("returns null for a generic news-article HTML", () => {
    const html = '<html><body><article><h1>News</h1><p>body</p></article></body></html>';
    expect(detectWikiPlatform(html)).toBe(null);
  });

  it("returns null for empty/short HTML", () => {
    expect(detectWikiPlatform("")).toBe(null);
    expect(detectWikiPlatform("<html></html>")).toBe(null);
  });

  it("only inspects the first 8KB of HTML (cheap detection)", () => {
    const padding = " ".repeat(10_000);
    const html = `<html>${padding}<div class="xwikicontent">x</div></html>`;
    // The xwikicontent is past the 8KB cutoff — should NOT match.
    expect(detectWikiPlatform(html)).toBe(null);
  });

  it("XWiki precedes Confluence when both signals present (XWiki-on-AUI-theme edge case)", () => {
    // XWiki's signal is more specific — wins on tie.
    const html = '<html><body><div class="xwikicontent aui-page-panel">x</div></body></html>';
    expect(detectWikiPlatform(html)).toBe("xwiki");
  });
});
