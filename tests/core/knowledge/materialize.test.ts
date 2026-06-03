import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filenameFromUrl } from "../../../src/core/knowledge/acquire";
import {
  inferMaterializer,
  materializeArticleHtml,
  materializeHtml,
  materializeHtmlToMarkdown,
  materializeJson,
  materializePassthrough,
  materializeWikiHtml,
} from "../../../src/core/knowledge/materialize";

const FIXTURES = join(import.meta.dir, "..", "..", "_fixtures");

describe("materializePassthrough", () => {
  it("strips BOM and normalizes line endings", () => {
    const input = Buffer.from("\uFEFFhello\r\nworld\r\n", "utf8");
    const r = materializePassthrough(input);
    expect(r.content).toBe("hello\nworld\n");
    expect(r.warnings).toEqual([]);
  });

  it("accepts string input verbatim", () => {
    const r = materializePassthrough("plain");
    expect(r.content).toBe("plain");
  });
});

describe("materializeJson", () => {
  it("pretty-prints valid JSON with 2-space indent", () => {
    const r = materializeJson('{"a":1,"b":[2,3]}');
    expect(r.content).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    expect(r.warnings).toEqual([]);
  });

  it("warns and falls back to passthrough on invalid JSON", () => {
    const r = materializeJson("not json");
    expect(r.content).toBe("not json");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("materializeHtmlToMarkdown", () => {
  it("extracts main content and converts to markdown", () => {
    const html = `<!doctype html><html><head><title>T</title></head><body>
      <nav><a href="/">Home</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav>
      <article>
        <h1>Hello</h1>
        <p>This is the main article body. It contains a substantial amount of prose so that
        Readability's content-density heuristic confidently selects this region as the primary
        content of the page, demoting navigational and footer chrome that surrounds it.</p>
        <p>A second paragraph of <strong>bold</strong> meaningful content. The article needs
        enough textual mass for Readability to score it well above the surrounding nav and
        footer regions, otherwise on tiny synthetic fixtures it conservatively keeps everything.</p>
        <p>Yet a third paragraph to push the content density above the threshold for reliable
        boilerplate stripping in this synthetic test case.</p>
      </article>
      <footer>footer with copyright info that should be stripped</footer>
    </body></html>`;
    const r = materializeHtmlToMarkdown(html);
    expect(r.content).toContain("Hello");
    expect(r.content).toContain("**bold**");
    expect(r.content).not.toContain("Home");
    expect(r.content).not.toContain("About");
    expect(r.content).not.toContain("copyright");
  });

  it("falls back to body-as-markdown when readability finds nothing", () => {
    const r = materializeHtmlToMarkdown("<html><body><p>tiny</p></body></html>");
    expect(r.content).toContain("tiny");
  });
});

describe("inferMaterializer", () => {
  it("infers by extension", () => {
    expect(inferMaterializer({ filename: "x.md" })).toBe("passthrough");
    expect(inferMaterializer({ filename: "x.txt" })).toBe("passthrough");
    expect(inferMaterializer({ filename: "x.json" })).toBe("json");
    expect(inferMaterializer({ filename: "x.html" })).toBe("html-to-md");
    expect(inferMaterializer({ filename: "x.htm" })).toBe("html-to-md");
    expect(inferMaterializer({ filename: "x.pdf" })).toBe("pdf-extract");
  });

  it("infers by content-type", () => {
    expect(inferMaterializer({ contentType: "text/html; charset=utf-8" })).toBe("html-to-md");
    expect(inferMaterializer({ contentType: "application/json" })).toBe("json");
    expect(inferMaterializer({ contentType: "application/pdf" })).toBe("pdf-extract");
    expect(inferMaterializer({ contentType: "text/plain" })).toBe("passthrough");
  });

  it("defaults to passthrough on unknown", () => {
    expect(inferMaterializer({ filename: "x.xyz" })).toBe("passthrough");
    expect(inferMaterializer({})).toBe("passthrough");
  });
});

describe("filenameFromUrl (exported)", () => {
  it("appends .html for text/html content type", () => {
    expect(filenameFromUrl("https://example.com/foo", "text/html")).toBe("foo.html");
  });
});

describe("materializeWikiHtml — XWiki", () => {
  const html = readFileSync(join(FIXTURES, "wiki-xwiki-page.html"), "utf8");

  it("preserves headings", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    expect(r.content).toContain("## Overview");
    expect(r.content).toContain("## Revisions");
    expect(r.content).toContain("## Migration example");
  });

  it("preserves the table as GFM (pipes)", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    expect(r.content).toContain("| Version | Date |");
    expect(r.content).toContain("| 1.0 |");
    expect(r.content).toContain("| 2.0 |");
  });

  it("preserves the fenced code block", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    expect(r.content).toContain("```");
    expect(r.content).toContain("curl -X POST");
  });

  it("preserves bullet list items", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    expect(r.content).toContain("Backward-compatible aliases");
  });

  it("strips the xwikiintro panel from noise selectors", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    expect(r.content).not.toContain("This intro panel should be stripped");
  });

  it("does NOT include header chrome from outside .xwikicontent", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/RevisionHistory", "xwiki");
    // The h1 outside .xwikicontent should be absent.
    expect(r.content).not.toContain("# Revision History");
  });
});

describe("materializeWikiHtml — Confluence", () => {
  const html = readFileSync(join(FIXTURES, "wiki-confluence-page.html"), "utf8");

  it("preserves heading + body content from main-content", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/Architecture", "confluence");
    expect(r.content).toContain("Architecture Overview");
    expect(r.content).toContain("**Service A**");
  });

  it("preserves the latency table as GFM", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/Architecture", "confluence");
    expect(r.content).toContain("| Stage |");
    expect(r.content).toContain("| Edge |");
  });

  it("strips toolbar + sidebar chrome", () => {
    const r = materializeWikiHtml(html, "https://wiki.example.com/Architecture", "confluence");
    expect(r.content).not.toContain("Toolbar");
    expect(r.content).not.toContain("Sidebar nav");
  });
});

describe("materializeWikiHtml — MediaWiki", () => {
  const html = readFileSync(join(FIXTURES, "wiki-mediawiki-page.html"), "utf8");

  it("preserves headings and tables", () => {
    const r = materializeWikiHtml(html, "https://en.wikipedia.org/wiki/Markdown", "mediawiki");
    expect(r.content).toContain("## Origins");
    expect(r.content).toContain("| Feature |");
  });

  it("strips mw-editsection markers", () => {
    const r = materializeWikiHtml(html, "https://en.wikipedia.org/wiki/Markdown", "mediawiki");
    expect(r.content).not.toContain("[edit]");
  });
});

describe("materializeArticleHtml — non-wiki HTML", () => {
  it("uses Readability path on news-article HTML and preserves GFM tables", () => {
    const html = `<!doctype html><html><body>
      <nav><a href="/">Home</a></nav>
      <article>
        <h1>News</h1>
        <p>This is the main article body. It contains a substantial amount of prose so that
        Readability's content-density heuristic confidently selects this region as the primary
        content. Readability needs enough text to score this region above surrounding chrome.</p>
        <p>Second paragraph adding more density. Adding meaningful content prevents Readability
        from conservatively keeping every node on tiny synthetic fixtures, so the navigation
        and footer regions are demoted as expected.</p>
        <p>Third paragraph for safe measure: Readability scores nodes proportionally to text
        density relative to siblings, so we want a clear winner here.</p>
        <table>
          <tr><th>A</th><th>B</th></tr>
          <tr><td>1</td><td>2</td></tr>
        </table>
      </article>
      <footer>copyright</footer>
    </body></html>`;
    const r = materializeArticleHtml(html, "https://example.com/news");
    expect(r.content).toContain("News");
    expect(r.content).toContain("| A | B |");
    expect(r.content).not.toContain("copyright");
  });
});

describe("materializeHtml dispatcher", () => {
  it("dispatches XWiki HTML to wiki-mode (no Readability)", () => {
    const html = readFileSync(join(FIXTURES, "wiki-xwiki-page.html"), "utf8");
    const r = materializeHtml(html, "https://wiki.example.com/RevisionHistory");
    // wiki-mode preserves the migration example AND the bullet list — Readability often drops one.
    expect(r.content).toContain("curl -X POST");
    expect(r.content).toContain("Backward-compatible aliases");
  });

  it("dispatches non-wiki HTML to article-mode", () => {
    const html = `<!doctype html><html><body>
      <nav><a href="/">Home</a></nav>
      <article>
        <h1>Generic Article</h1>
        <p>Body prose with enough text to satisfy Readability's content density heuristics
        — three paragraphs of moderate length is usually enough to score the article region
        above its sibling chrome.</p>
        <p>A second body paragraph helps Readability commit. The synthetic fixture needs
        enough words to behave like a real article rather than a tiny test case.</p>
        <p>Third paragraph closes the article body.</p>
      </article>
    </body></html>`;
    const r = materializeHtml(html, "https://example.com/article");
    expect(r.content).toContain("Generic Article");
    expect(r.content).not.toContain("Home");
  });
});

describe("materializeHtml — frontmatter", () => {
  it("prepends frontmatter with title from <title> tag", () => {
    const html = readFileSync(join(FIXTURES, "wiki-xwiki-page.html"), "utf8");
    const r = materializeHtml(html, "https://wiki.example.com/RevisionHistory");
    expect(r.content.startsWith("---\n")).toBe(true);
    expect(r.content).toContain('title: "Revision History — Service X"');
    expect(r.content).toContain('source_url: "https://wiki.example.com/RevisionHistory"');
    expect(r.content).toMatch(/fetched_at: "20\d\d-\d\d-\d\dT/);
  });
});
