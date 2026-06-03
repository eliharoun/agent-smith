import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireViaMcp } from "../../../src/core/knowledge/acquire-via";
import { McpClientPool } from "../../../src/io/mcp-client-pool";
import { SmithError } from "../../../src/core/smith-error";
import type { McpClient } from "../../../src/io/mcp-client";

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
    // Server doesn't have a "create_x" tool; the call fails with the
    // enriched method-not-found SmithError. We assert the guard PASSED
    // (the failure is from the missing tool, not the guard) by checking
    // for the wrapper's headline.
    await expect(acquireViaMcp(
      { server: "echo", tool: "create_x", allowWriteTool: true },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    )).rejects.toThrow(/via\.tool 'create_x'.*validation failed/);
  }, HEAVY_TIMEOUT);

  it("propagates MCP error", async () => {
    pool = new McpClientPool();
    await expect(acquireViaMcp(
      { server: "echo", tool: "fetch_unknown" },
      "https://example.com/x",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    )).rejects.toThrow();
  }, HEAVY_TIMEOUT);

  it("wraps the URL in an array when the tool's input schema declares inputs: string[]", async () => {
    pool = new McpClientPool();
    const arts = await acquireViaMcp(
      { server: "echo", tool: "FetchMany" },
      "https://example.com/batch",
      { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
    );
    // FetchMany echoes inputs joined by newlines — we expect the URL to
    // appear because acquireViaMcp wrapped it as { inputs: [url] }.
    expect(arts).toHaveLength(1);
    expect(arts[0]?.bytes.toString("utf8")).toBe("https://example.com/batch");
  }, HEAVY_TIMEOUT);

  it("wraps -32601 with available URL-shaped tools list", async () => {
    pool = new McpClientPool();
    let caught: unknown;
    try {
      await acquireViaMcp(
        // Read-shaped name (starts with "fetch") so the guard passes;
        // the server doesn't expose this tool so it fails with -32601.
        { server: "echo", tool: "fetch_does_not_exist" },
        "https://example.com/x",
        { pool, spawnOptsFor: () => ({ command: "bun", args: [FIXTURE] }) },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const se = caught as SmithError;
    expect(se.payload.code).toBe("validation-failed");
    if (se.payload.code !== "validation-failed") return;
    expect(se.payload.what).toContain("fetch_does_not_exist");
    expect(se.payload.what).toContain("echo");
    const reasons = se.payload.reasons.join("\n");
    expect(reasons).toContain("Fetch");
    expect(reasons).toContain("FetchMany");
    expect(reasons).toContain("URL-shaped tools");
  }, HEAVY_TIMEOUT);

  it("passes through non-32601 errors unchanged", async () => {
    pool = new McpClientPool();
    // The pool's connect path throws a plain Error when initialize times
    // out (no JSON-RPC code involved). Use a non-existent command so the
    // child fails before initialize completes — acquire() rejects with a
    // non-mcp Error that should propagate as-is.
    let caught: unknown;
    try {
      await acquireViaMcp(
        { server: "missing", tool: "Fetch" },
        "https://example.com/x",
        {
          pool,
          spawnOptsFor: () => ({
            command: "/nonexistent/binary/that/does/not/exist",
            args: [],
            initializeTimeoutMs: 500,
          }),
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Not the new -32601 SmithError shape: either a plain Error, or a
    // SmithError with a different code. Specifically NOT validation-failed
    // with our "URL-shaped tools" reason.
    if (caught instanceof SmithError && caught.payload.code === "validation-failed") {
      const reasons = caught.payload.reasons.join("\n");
      expect(reasons).not.toContain("URL-shaped tools");
    }
  }, HEAVY_TIMEOUT);

  it("surfaces a fallback message when listTools also fails", async () => {
    // Fake McpClient: callTool throws -32601, listTools throws too.
    const fakeClient = {
      callTool: () => Promise.reject(new Error("mcp error -32601: method not found")),
      listTools: () => Promise.reject(new Error("server disconnected")),
    } as unknown as McpClient;
    const fakePool = {
      acquire: () => Promise.resolve(fakeClient),
      shutdown: () => Promise.resolve(),
    };
    let caught: unknown;
    try {
      await acquireViaMcp(
        // Use via.args so resolveArgs doesn't call listTools first.
        { server: "ghost", tool: "fetch_thing", args: { url: "https://x" } },
        "https://example.com/x",
        {
          pool: fakePool as unknown as McpClientPool,
          spawnOptsFor: () => ({ command: "bun", args: [] }),
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const se = caught as SmithError;
    expect(se.payload.code).toBe("validation-failed");
    if (se.payload.code !== "validation-failed") return;
    const reasons = se.payload.reasons.join("\n");
    expect(reasons).toContain("listing available tools also failed");
    expect(reasons).toContain("ghost");
    expect(reasons).not.toContain("URL-shaped tools");
  });
});
