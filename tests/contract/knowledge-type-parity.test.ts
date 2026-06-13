import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_TYPES } from "../../src/core/knowledge/validator";
import { KnowledgeSourceType as GuiKnowledgeSourceType } from "../../gui/shared/src/schemas/knowledge";

describe("core <-> GUI knowledge type parity", () => {
  test("npm is the ONLY GUI type not yet acquirable in core (known-deferred)", () => {
    const offered = (GuiKnowledgeSourceType.options as string[]).filter((t) => t !== "url"); // url = deprecated input alias
    const notInCore = offered.filter((t) => !new Set<string>(SUPPORTED_TYPES).has(t));
    // When npm gains a core acquirer (or is removed from the GUI enum), update this expectation.
    expect(notInCore).toEqual(["npm"]);
  });
  test("webpage/web/mcp present in GUI enum", () => {
    const g: string[] = GuiKnowledgeSourceType.options;
    expect(g).toContain("webpage");
    expect(g).toContain("web");
    expect(g).toContain("mcp");
  });
});

describe("GUI modal <-> gui-shared type parity (string-scan)", () => {
  const guiWebRoot = join(import.meta.dir, "../../gui/web/src/panels/KnowledgeSources");

  test("AddKnowledgeSourceModal SourceType union equals gui-shared enum minus 'url'", () => {
    const src = readFileSync(join(guiWebRoot, "AddKnowledgeSourceModal.tsx"), "utf8");
    // Extract the union: `type SourceType = "file" | "dir" | ...;`
    const match = src.match(/type\s+SourceType\s*=\s*([^;]+);/);
    expect(match).not.toBeNull();
    const unionStr = match![1]!;
    // Parse quoted strings from the union
    const types = [...unionStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
    // Expected: gui-shared enum minus deprecated 'url'
    const expected = (GuiKnowledgeSourceType.options as string[])
      .filter((t) => t !== "url")
      .sort();
    expect(types).toEqual(expected);
  });

  test("EditKnowledgeSourceModal buildSource switch covers every gui-shared type", () => {
    const src = readFileSync(join(guiWebRoot, "EditKnowledgeSourceModal.tsx"), "utf8");
    // Find all case labels in the buildSource switch. The function uses
    // `switch (original.type)` with `case "x":` lines.
    const buildSourceBlock = src.slice(src.indexOf("function buildSource("));
    const caseMatches = [...buildSourceBlock.matchAll(/case\s+"([^"]+)"/g)].map((m) => m[1]!);
    const casesSet = new Set(caseMatches);
    // Every gui-shared type must have a case handler. 'url' shares webpage's
    // branch (both handled in the same case arm: `case "url": case "webpage":`).
    for (const t of GuiKnowledgeSourceType.options as string[]) {
      if (t === "url") {
        // url shares webpage's branch
        expect(casesSet.has("url") || casesSet.has("webpage")).toBe(true);
      } else {
        expect(casesSet.has(t)).toBe(true);
      }
    }
  });
});
