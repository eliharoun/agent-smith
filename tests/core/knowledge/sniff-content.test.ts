import { describe, expect, it } from "bun:test";
import { sniffArtifact } from "../../../src/core/knowledge/sniff-content";

describe("sniffArtifact — JSON envelope unwrapping", () => {
  it("unwraps { content: { content: \"<html>\" } }", () => {
    const env = JSON.stringify({ content: { content: "<html><body><h1>hi</h1></body></html>" } });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("<html><body><h1>hi</h1></body></html>");
    expect(r.contentType).toBe("text/html");
    expect(r.filename).toBe("page.html");
  });

  it("unwraps { content: \"<html>\" }", () => {
    const env = JSON.stringify({ content: "<html><body>x</body></html>" });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("<html><body>x</body></html>");
    expect(r.contentType).toBe("text/html");
  });

  it("unwraps { html: \"<html>\" }", () => {
    const env = JSON.stringify({ html: "<html><body>x</body></html>" });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("<html><body>x</body></html>");
  });

  it("unwraps { body: \"...\" }", () => {
    const env = JSON.stringify({ body: "<div>body content</div>" });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("<div>body content</div>");
  });

  it("unwraps { markdown: \"# title\" } and detects markdown", () => {
    const env = JSON.stringify({ markdown: "# title\n\nbody" });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("# title\n\nbody");
    expect(r.contentType).toBe("text/markdown");
    expect(r.filename).toBe("page.md");
  });

  it("unwraps { result: \"...\" }", () => {
    const env = JSON.stringify({ result: "<html><body>x</body></html>" });
    const r = sniffArtifact(Buffer.from(env, "utf8"), { url: "https://example.com/page" });
    expect(r.bytes.toString("utf8")).toBe("<html><body>x</body></html>");
  });
});

describe("sniffArtifact — direct content (no envelope)", () => {
  it("detects raw HTML by leading <html>", () => {
    const r = sniffArtifact(
      Buffer.from("<html><body>x</body></html>", "utf8"),
      { url: "https://example.com/foo" },
    );
    expect(r.contentType).toBe("text/html");
    expect(r.filename).toBe("foo.html");
    expect(r.materializer).toBe("html-to-md");
  });

  it("detects raw HTML by leading <div>", () => {
    const r = sniffArtifact(
      Buffer.from("<div class=\"x\">x</div>", "utf8"),
      { url: "https://example.com/foo" },
    );
    expect(r.contentType).toBe("text/html");
  });

  it("detects markdown by leading heading", () => {
    const r = sniffArtifact(
      Buffer.from("# title\n\nbody", "utf8"),
      { url: "https://example.com/foo" },
    );
    expect(r.contentType).toBe("text/markdown");
    expect(r.filename).toBe("foo.md");
  });

  it("detects JSON (non-envelope shape)", () => {
    const r = sniffArtifact(
      Buffer.from('{"unrelated":"data","x":42}', "utf8"),
      { url: "https://example.com/foo" },
    );
    expect(r.contentType).toBe("application/json");
    expect(r.filename).toBe("foo.json");
  });

  it("falls back to text/plain", () => {
    const r = sniffArtifact(
      Buffer.from("just some prose with no structure", "utf8"),
      { url: "https://example.com/foo" },
    );
    expect(r.contentType).toBe("text/plain");
    expect(r.filename).toBe("foo.txt");
  });

  it("honors declared content-type over byte sniffing", () => {
    // The bytes look like markdown but caller declared text/html.
    const r = sniffArtifact(
      Buffer.from("# this looks like markdown", "utf8"),
      { url: "https://example.com/foo", declaredCt: "text/html" },
    );
    expect(r.contentType).toBe("text/html");
  });

  it("does not unwrap a JSON object that lacks any known envelope key", () => {
    const json = JSON.stringify({ unrelated: "x", random: 42 });
    const r = sniffArtifact(
      Buffer.from(json, "utf8"),
      { url: "https://example.com/foo" },
    );
    // Bytes preserved; content-type is application/json (round-tripped).
    expect(r.bytes.toString("utf8")).toBe(json);
    expect(r.contentType).toBe("application/json");
  });

  it("handles empty input gracefully", () => {
    const r = sniffArtifact(Buffer.from("", "utf8"), { url: "https://example.com/foo" });
    expect(r.contentType).toBe("text/plain");
  });
});
