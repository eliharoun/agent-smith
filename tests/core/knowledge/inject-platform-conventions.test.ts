import { describe, expect, test } from "bun:test";
import { injectPlatformConventions } from "../../../src/core/knowledge/permission-grant";
import type { RenderedAgent } from "../../../src/core/types";

const fakeKiro = (existing: string[] = []): RenderedAgent => ({
  target: "kiro",
  format: "json",
  relativePath: "x.json",
  data: existing.length > 0 ? { name: "x", resources: existing } : { name: "x" },
});

describe("injectPlatformConventions", () => {
  test("empty URIs → unchanged (same reference)", () => {
    const r = fakeKiro();
    const out = injectPlatformConventions(r, []);
    expect(out).toBe(r);
  });

  test("kiro: appends URIs to data.resources", () => {
    const r = fakeKiro(["file://README.md"]);
    const out = injectPlatformConventions(r, ["file://.kiro/steering/**/*.md"]);
    if (out.format !== "json") throw new Error("expected json");
    const resources = out.data.resources as string[];
    expect(resources).toContain("file://README.md");
    expect(resources).toContain("file://.kiro/steering/**/*.md");
  });

  test("kiro: dedupes URIs already present", () => {
    const r = fakeKiro(["file://.kiro/steering/**/*.md"]);
    const out = injectPlatformConventions(r, ["file://.kiro/steering/**/*.md"]);
    if (out.format !== "json") throw new Error("expected json");
    const resources = out.data.resources as string[];
    expect(resources.filter((u) => u === "file://.kiro/steering/**/*.md")).toHaveLength(1);
  });

  test("kiro: sorts resources alphabetically (manifest hash idempotency)", () => {
    const r = fakeKiro(["file://z.md"]);
    const out = injectPlatformConventions(r, ["file://a.md", "file://m.md"]);
    if (out.format !== "json") throw new Error("expected json");
    const resources = out.data.resources as string[];
    expect(resources).toEqual(["file://a.md", "file://m.md", "file://z.md"]);
  });

  test("markdown-frontmatter: no-op for v1 (no conventions registered)", () => {
    const r: RenderedAgent = {
      target: "opencode",
      format: "markdown-frontmatter",
      relativePath: "x.md",
      frontmatter: {},
      body: "",
    };
    const out = injectPlatformConventions(r, ["file://x"]);
    expect(out).toBe(r);
  });
});
