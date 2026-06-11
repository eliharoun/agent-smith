import { describe, expect, test } from "bun:test";
import { KnowledgeSourceSchema } from "../../../src/core/knowledge/schema";

const ok = { id: "docs", delivery: "auto" as const };

describe("web variant", () => {
  test("crawl with bounds is valid", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "https://docs.example.com/", mode: "crawl", maxPages: 50, depth: 3, sameOrigin: true, include: ["**/api/**"] });
    expect(r.success).toBe(true);
  });
  test("llms-txt rejects crawl-only fields", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "https://x.com/llms.txt", mode: "llms-txt", depth: 2 });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("depth");
  });
  test("openapi rejects sameOrigin", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "https://x.com/openapi.json", mode: "openapi", sameOrigin: true });
    expect(r.success).toBe(false);
  });
  test("lazy is forbidden on web", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "https://x.com/", mode: "crawl", lazy: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("lazy");
  });
  test("invalid url rejected", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "not a url", mode: "crawl" });
    expect(r.success).toBe(false);
  });
  test("missing mode rejected", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "web", url: "https://x.com/" });
    expect(r.success).toBe(false);
  });
});
