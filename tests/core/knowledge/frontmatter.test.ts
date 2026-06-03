import { describe, expect, it } from "bun:test";
import { prependFrontmatter } from "../../../src/core/knowledge/frontmatter";

describe("prependFrontmatter", () => {
  it("emits a YAML block then a blank line then the content", () => {
    const r = prependFrontmatter("# Title\n\nbody\n", {
      title: "Title",
      source_url: "https://example.com/foo",
      fetched_at: "2026-06-03T15:46:14.405Z",
    });
    expect(r).toBe(
      `---
title: "Title"
source_url: "https://example.com/foo"
fetched_at: "2026-06-03T15:46:14.405Z"
---

# Title

body
`
    );
  });

  it("omits fields whose value is empty string", () => {
    const r = prependFrontmatter("body", {
      title: "",
      source_url: "https://example.com/foo",
      fetched_at: "2026-06-03T15:46:14.405Z",
    });
    expect(r).not.toContain("title:");
    expect(r).toContain('source_url: "https://example.com/foo"');
  });

  it("omits fields whose value is undefined", () => {
    const r = prependFrontmatter("body", {
      source_url: "https://example.com/foo",
      fetched_at: "2026-06-03T15:46:14.405Z",
    });
    expect(r).not.toContain("title:");
  });

  it("emits no frontmatter and no leading blank when every field is omitted", () => {
    const r = prependFrontmatter("body", {});
    expect(r).toBe("body");
  });

  it("escapes quotes in title", () => {
    const r = prependFrontmatter("body", { title: 'has "quotes"' });
    expect(r).toContain('title: "has \\"quotes\\""');
  });
});
