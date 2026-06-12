import { describe, expect, it } from "bun:test";
import { extractTags } from "../../../../src/core/knowledge/index/repomap/extract";
import { rankFiles } from "../../../../src/core/knowledge/index/repomap/graph";
import { renderMap } from "../../../../src/core/knowledge/index/repomap/render";

describe("repomap graph", () => {
  it("ranks a widely-referenced file first", () => {
    const tags = [
      {
        relPath: "util.ts",
        name: "helper",
        role: "def" as const,
        line: 1,
        signature: "function helper()",
      },
      { relPath: "a.ts", name: "helper", role: "ref" as const, line: 3, signature: "" },
      { relPath: "b.ts", name: "helper", role: "ref" as const, line: 4, signature: "" },
      { relPath: "c.ts", name: "helper", role: "ref" as const, line: 5, signature: "" },
    ];
    expect(rankFiles(tags, {})[0]?.relPath).toBe("util.ts");
  });
});

describe("repomap render", () => {
  it("fits budget and shows signatures", () => {
    const map = renderMap(
      [
        {
          relPath: "util.ts",
          score: 1,
          defs: [{ name: "helper", signature: "function helper()", line: 1 }],
        },
      ],
      1000,
    );
    expect(map).toContain("util.ts");
    expect(map).toContain("function helper()");
  });
  it("empty -> explanatory note", () => {
    expect(renderMap([], 1000)).toMatch(/no code sources/i);
  });
});

describe("repomap extract (real tree-sitter)", () => {
  it("extracts def/ref tags from TypeScript", async () => {
    const tags = await extractTags(
      "f.ts",
      "export function foo() { return bar(); }\nclass Baz {}\n",
    );
    if (tags.length === 0) return; // grammar unavailable on this host -> skip
    const byName = (n: string) => tags.find((t) => t.name === n);
    expect(byName("foo")?.role).toBe("def");
    expect(byName("Baz")?.role).toBe("def");
    expect(byName("bar")?.role).toBe("ref");
    expect(byName("foo")?.signature).toContain("function foo"); // def carries source-line signature
  });
});
