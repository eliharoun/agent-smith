import { describe, it, expect } from "bun:test";
import type { Via } from "../../src/core/knowledge/types";
import type { CanonicalConfig } from "../../src/core/types";
import { SmithError } from "../../src/core/smith-error";

describe("Via type", () => {
  it("requires server and tool", () => {
    const v: Via = { server: "mcp-x", tool: "fetch" };
    expect(v.server).toBe("mcp-x");
  });

  it("allows args + allowWriteTool", () => {
    const v: Via = {
      server: "x",
      tool: "y",
      args: { url: "https://example.com" },
      allowWriteTool: false,
    };
    expect(v.args?.url).toBe("https://example.com");
    expect(v.allowWriteTool).toBe(false);
  });
});

describe("CanonicalConfig.mcp shape", () => {
  it("allows required + peer", () => {
    const c: Pick<CanonicalConfig, "mcp"> = { mcp: { required: ["a"], peer: ["b"] } };
    expect(c.mcp?.required).toEqual(["a"]);
  });

  it("allows mcp omitted", () => {
    const c: Pick<CanonicalConfig, "mcp"> = {};
    expect(c.mcp).toBeUndefined();
  });
});

describe("SmithError internal-error variant", () => {
  it("constructs", () => {
    const e = new SmithError({ code: "internal-error", message: "boom" });
    expect(e.payload.code).toBe("internal-error");
  });
});
