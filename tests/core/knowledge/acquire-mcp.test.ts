import { describe, expect, test } from "bun:test";
import { acquireViaMcp } from "../../../src/core/knowledge/acquire-via";

function fakePool(captured: { tool?: string; args?: unknown }) {
  const client = {
    async callTool(tool: string, args: Record<string, unknown>) { captured.tool = tool; captured.args = args; return { isError: false, content: [{ type: "text", text: "notion result body" }] }; },
    async listTools() { return [{ name: "search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }]; },
  };
  return { pool: { async acquire() { return client as never; } } as never, spawnOptsFor: () => ({}) as never };
}

describe("acquireViaMcp for mcp sources", () => {
  test("explicit args passed verbatim; text returned as artifact (no locator)", async () => {
    const cap: { tool?: string; args?: unknown } = {};
    const { pool, spawnOptsFor } = fakePool(cap);
    const arts = await acquireViaMcp({ server: "notion", tool: "search", args: { query: "onboarding" } }, undefined, { pool, spawnOptsFor });
    expect(cap.tool).toBe("search");
    expect(cap.args).toEqual({ query: "onboarding" });
    expect(arts).toHaveLength(1);
    expect(arts[0]!.bytes.toString("utf8")).toContain("notion result body");
  });
  test("synthetic locator accepted and used only for naming", async () => {
    const cap: { tool?: string; args?: unknown } = {};
    const { pool, spawnOptsFor } = fakePool(cap);
    const arts = await acquireViaMcp({ server: "notion", tool: "search", args: { query: "x" } }, "mcp://notion/search", { pool, spawnOptsFor });
    expect(arts).toHaveLength(1);
  });
});
