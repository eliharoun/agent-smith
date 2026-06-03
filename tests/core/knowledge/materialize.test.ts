import { describe, expect, it } from "bun:test";
import { filenameFromUrl } from "../../../src/core/knowledge/acquire";
import {
  inferMaterializer,
  materializeHtmlToMarkdown,
  materializeJson,
  materializePassthrough,
} from "../../../src/core/knowledge/materialize";

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
