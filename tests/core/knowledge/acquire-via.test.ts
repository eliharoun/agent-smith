import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireViaMcp } from "../../../src/core/knowledge/acquire-via";
import { McpClientPool } from "../../../src/io/mcp-client-pool";

const FIXTURE = join(import.meta.dir, "..", "..", "_fixtures", "echo-mcp-server.ts");
const HEAVY_TIMEOUT = 30_000;
let tmpDir: string;
let pool: McpClientPool | null = null;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "av-"));
  pool = null;
});
afterEach(async () => {
  if (pool) await pool.shutdown();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("acquireViaMcp", () => {
  it("calls the named tool and returns one text artifact with correct shape", async () => {
    pool = new McpClientPool();
    const arts = await acquireViaMcp(
      { server: "echo", tool: "Fetch" },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    );
    expect(arts).toHaveLength(1);
    expect(arts[0]?.filename).toMatch(/x\.txt$/);
    expect(arts[0]?.relPath).toBe(arts[0]?.filename);
    expect(arts[0]?.bytes.toString("utf8")).toContain("https://example.com/x");
    expect(arts[0]?.contentType).toBe("text/plain");
  }, HEAVY_TIMEOUT);

  it("uses explicit via.args when provided", async () => {
    pool = new McpClientPool();
    const arts = await acquireViaMcp(
      { server: "echo", tool: "Fetch", args: { custom: "explicit" } },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    );
    expect(arts[0]?.bytes.toString("utf8")).toContain("explicit");
  }, HEAVY_TIMEOUT);

  it("rejects write-shaped tool names without allowWriteTool", async () => {
    pool = new McpClientPool();
    await expect(acquireViaMcp(
      { server: "echo", tool: "delete_thing" },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    )).rejects.toThrow(/read-shaped|allowWriteTool/);
  }, HEAVY_TIMEOUT);

  it("accepts write-shaped tools with allowWriteTool: true", async () => {
    pool = new McpClientPool();
    // Server doesn't have a "create_x" tool; will fail with -32601.
    // We assert the guard PASSED (the failure is from the missing tool,
    // not the guard).
    await expect(acquireViaMcp(
      { server: "echo", tool: "create_x", allowWriteTool: true },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    )).rejects.toThrow(/-32601|not found/);
  }, HEAVY_TIMEOUT);

  it("propagates MCP error", async () => {
    pool = new McpClientPool();
    await expect(acquireViaMcp(
      { server: "echo", tool: "fetch_unknown" },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    )).rejects.toThrow();
  }, HEAVY_TIMEOUT);
});
