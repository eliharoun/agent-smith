import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClientPool } from "../../src/io/mcp-client-pool";

const FIXTURE = join(import.meta.dir, "..", "_fixtures", "echo-mcp-server.ts");
const HEAVY_TIMEOUT = 30_000;
let tmpDir: string;
let tmpStateHome: string;
let origXdgStateHome: string | undefined;
let pool: McpClientPool | null = null;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mcp-pool-"));
  tmpStateHome = await mkdtemp(join(tmpdir(), "mcp-state-"));
  origXdgStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = tmpStateHome;
  pool = null;
});
afterEach(async () => {
  if (pool) await pool.shutdown();
  if (origXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = origXdgStateHome;
  await rm(tmpDir, { recursive: true, force: true });
  await rm(tmpStateHome, { recursive: true, force: true });
});

describe("McpClientPool", () => {
  it("returns the same client for the same key + opts", async () => {
    pool = new McpClientPool();
    const c1 = await pool.acquire("srv", { command: "bun", args: [FIXTURE] });
    const c2 = await pool.acquire("srv", { command: "bun", args: [FIXTURE] });
    expect(c1).toBe(c2);
  }, HEAVY_TIMEOUT);

  it("returns different clients for different opts under the same name", async () => {
    pool = new McpClientPool();
    const c1 = await pool.acquire("srv", { command: "bun", args: [FIXTURE] });
    const c2 = await pool.acquire("srv", { command: "bun", args: [FIXTURE, "--variant"] });
    expect(c1).not.toBe(c2);
  }, HEAVY_TIMEOUT);

  it("dedupes concurrent acquires with same key+opts", async () => {
    pool = new McpClientPool();
    const [a, b, c] = await Promise.all([
      pool.acquire("srv", { command: "bun", args: [FIXTURE] }),
      pool.acquire("srv", { command: "bun", args: [FIXTURE] }),
      pool.acquire("srv", { command: "bun", args: [FIXTURE] }),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  }, HEAVY_TIMEOUT);

  it("shutdown closes all and refuses subsequent acquires", async () => {
    pool = new McpClientPool();
    await pool.acquire("a", { command: "bun", args: [FIXTURE] });
    await pool.shutdown();
    expect(pool.size()).toBe(0);
    await expect(pool.acquire("b", { command: "bun", args: [FIXTURE] })).rejects.toThrow(/shutting down|closed/);
  }, HEAVY_TIMEOUT);
});
