import { describe, expect, test } from "bun:test";
import { getMcpPreset, listMcpPresets } from "../../../src/core/knowledge/mcp-presets";
describe("mcp presets", () => {
  test("known preset returns server + tool defaults", () => { const p = getMcpPreset("notion"); expect(p).toBeDefined(); expect(p!.server.length).toBeGreaterThan(0); expect(p!.tool.length).toBeGreaterThan(0); });
  test("unknown preset returns undefined", () => { expect(getMcpPreset("does-not-exist")).toBeUndefined(); });
  test("listMcpPresets returns a non-empty array of names", () => { const names = listMcpPresets().map((p) => p.name); expect(names).toContain("notion"); });
});
