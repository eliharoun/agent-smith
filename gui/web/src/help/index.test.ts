import { describe, expect, it } from "vitest";
import { getFieldHelp } from "./index";
import { knowledgeHelp } from "./knowledge";

describe("getFieldHelp", () => {
  it("returns the entry for a known knowledge key", () => {
    const e = getFieldHelp("knowledge.delivery");
    expect(e).toBeDefined();
    expect(e?.help).toMatch(/inline|file|auto/i);
  });

  it("returns undefined for an unknown key", () => {
    expect(getFieldHelp("does.not.exist")).toBeUndefined();
  });

  it("each knowledge.* registry entry has a non-empty help string ≤ 280 chars", () => {
    const entries = Object.entries(knowledgeHelp);
    expect(entries.length).toBeGreaterThan(0);
    for (const [k, v] of entries) {
      expect(k).toMatch(/^knowledge\./);
      expect(typeof v.help).toBe("string");
      expect(v.help.length).toBeGreaterThan(0);
      // Tooltips stay tight; soft cap matches the canonical schema's `summary` cap.
      expect(v.help.length, `entry ${k} exceeds 280 chars`).toBeLessThanOrEqual(280);
    }
  });

  it("covers the field IDs the knowledge modals reference", () => {
    const required = [
      "knowledge.id",
      "knowledge.type",
      "knowledge.path",
      "knowledge.url",
      "knowledge.include",
      "knowledge.exclude",
      "knowledge.description",
      "knowledge.delivery",
      "knowledge.summary",
      "knowledge.toc",
      "knowledge.retrieval.mode",
      "knowledge.retrieval.mcpUrl",
      "knowledge.materialize",
      "knowledge.refresh.mode",
      "knowledge.refresh.ttl",
      "knowledge.refresh.timeout",
      "knowledge.optional",
      "knowledge.inlineBudgetTokens",
    ];
    for (const k of required) {
      expect(getFieldHelp(k), `missing help entry for ${k}`).toBeDefined();
    }
  });
});
