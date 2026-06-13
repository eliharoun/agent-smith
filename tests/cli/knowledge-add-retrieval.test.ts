import { describe, expect, it } from "bun:test";
import { constructSource, type KnowledgeAddOptions } from "../../src/cli/commands/knowledge/add";

const base: KnowledgeAddOptions = {
  bundleDir: "/tmp/x",
  type: "file",
  pathOrUrl: "docs/readme.md",
};

describe("constructSource retrieval", () => {
  it("attaches retrieval { mode: hybrid } for --retrieval hybrid", () => {
    const src = constructSource({ ...base, retrieval: "hybrid" }, "readme") as unknown as Record<
      string,
      unknown
    >;
    expect(src.retrieval).toEqual({ mode: "hybrid" });
  });

  it("attaches retrieval { mode: bm25 } for --retrieval bm25", () => {
    const src = constructSource({ ...base, retrieval: "bm25" }, "readme") as unknown as Record<
      string,
      unknown
    >;
    expect(src.retrieval).toEqual({ mode: "bm25" });
  });

  it("throws when --retrieval external-mcp has no --retrieval-mcp-url", () => {
    let thrown: unknown;
    try {
      constructSource({ ...base, retrieval: "external-mcp" }, "readme");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const payload = (thrown as { payload: { reasons: string[] } }).payload;
    expect(payload.reasons.join(" ")).toMatch(/requires --retrieval-mcp-url/);
  });

  it("attaches mode + mcpUrl for --retrieval external-mcp --retrieval-mcp-url", () => {
    const src = constructSource(
      { ...base, retrieval: "external-mcp", retrievalMcpUrl: "https://x" },
      "readme",
    ) as unknown as Record<string, unknown>;
    expect(src.retrieval).toEqual({ mode: "external-mcp", mcpUrl: "https://x" });
  });

  it("throws when --retrieval-mcp-url is set without --retrieval", () => {
    let thrown: unknown;
    try {
      constructSource({ ...base, retrievalMcpUrl: "https://x" }, "readme");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const payload = (thrown as { payload: { reasons: string[] } }).payload;
    expect(payload.reasons.join(" ")).toMatch(/requires --retrieval external-mcp/);
  });

  it("throws when --retrieval-mcp-url is set with --retrieval bm25", () => {
    let thrown: unknown;
    try {
      constructSource({ ...base, retrieval: "bm25", retrievalMcpUrl: "https://x" }, "readme");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const payload = (thrown as { payload: { reasons: string[] } }).payload;
    expect(payload.reasons.join(" ")).toMatch(/only valid with --retrieval external-mcp/);
  });

  it("throws when --retrieval-mcp-url is set with --retrieval hybrid", () => {
    let thrown: unknown;
    try {
      constructSource({ ...base, retrieval: "hybrid", retrievalMcpUrl: "https://x" }, "readme");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const payload = (thrown as { payload: { reasons: string[] } }).payload;
    expect(payload.reasons.join(" ")).toMatch(/only valid with --retrieval external-mcp/);
  });

  it("throws on an invalid --retrieval mode", () => {
    let thrown: unknown;
    try {
      constructSource({ ...base, retrieval: "bogus" }, "readme");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const payload = (thrown as { payload: { reasons: string[] } }).payload;
    expect(payload.reasons.join(" ")).toMatch(/--retrieval must be one of/);
  });

  it("leaves retrieval unset when --retrieval is not passed", () => {
    const src = constructSource({ ...base }, "readme") as unknown as Record<string, unknown>;
    expect("retrieval" in src).toBe(false);
  });
});
