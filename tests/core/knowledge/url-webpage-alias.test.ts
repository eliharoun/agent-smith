import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../../src/core/config-schema";
import { collectKnowledgeDeprecations } from "../../../src/core/config-schema";

const base = {
  schemaVersion: 1,
  name: "alias-agent",
  description: "Use proactively for alias testing of knowledge types",
  targets: ["kiro"],
  modelTier: "balanced",
};

describe("url -> webpage alias", () => {
  test("legacy type:url parses and normalizes to webpage", () => {
    const res = parseConfig({ ...base, knowledge: { sources: [{ id: "docs", type: "url", url: "https://example.com", delivery: "auto" }] } });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error(res.errors.join("; "));
    const src = res.data.knowledge!.sources![0]!;
    expect(src.type).toBe("webpage");
    expect((src as { url: string }).url).toBe("https://example.com");
  });
  test("canonical type:webpage parses unchanged", () => {
    const res = parseConfig({ ...base, knowledge: { sources: [{ id: "docs", type: "webpage", url: "https://example.com", delivery: "auto" }] } });
    expect(res.success).toBe(true);
  });
  test("collectKnowledgeDeprecations reports aliased url sources with migration hint", () => {
    const warnings = collectKnowledgeDeprecations({ ...base, knowledge: { sources: [{ id: "docs", type: "url", url: "https://example.com", delivery: "auto" }] } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("docs");
    expect(warnings[0]).toContain("type: url");
    expect(warnings[0]).toContain("type: webpage");
  });
  test("no deprecation warning for canonical webpage", () => {
    const warnings = collectKnowledgeDeprecations({ ...base, knowledge: { sources: [{ id: "docs", type: "webpage", url: "https://example.com", delivery: "auto" }] } });
    expect(warnings).toHaveLength(0);
  });
});
