import { McpClient, type McpClientOpts } from "./mcp-client";

/**
 * Process-wide pool of connected McpClient instances. Keyed by
 * `<name>::<JSON.stringify(opts)>` so two acquires with the same name
 * but different spawn opts get different clients (same-name collisions
 * are intentional; spawn-opt mismatches are not).
 *
 * Spawn-dedupes concurrent acquires for the same key. Refuses new
 * acquires after `shutdown()` is called.
 *
 * Pool's lifetime equals one CLI command invocation; callers must
 * `await pool.shutdown()` in a `finally` block. v1.2 has no idle-eviction;
 * Phase 3 adds it for daemon scenarios.
 */
export class McpClientPool {
  private readonly clients = new Map<string, McpClient>();
  private readonly inflight = new Map<string, Promise<McpClient>>();
  private shuttingDown = false;

  async acquire(name: string, opts: McpClientOpts): Promise<McpClient> {
    if (this.shuttingDown) throw new Error("pool is shutting down");
    const key = `${name}::${JSON.stringify(opts)}`;
    const existing = this.clients.get(key);
    if (existing) return existing;
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const promise = this.connectNew(opts).then((client) => {
      if (this.shuttingDown) {
        // Race: shutdown landed before connect resolved. Close eagerly.
        void client.close();
        throw new Error("pool was shut down during connect");
      }
      this.clients.set(key, client);
      this.inflight.delete(key);
      return client;
    }).catch((err) => {
      this.inflight.delete(key);
      throw err;
    });
    this.inflight.set(key, promise);
    return promise;
  }

  size(): number {
    return this.clients.size;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const closeAll = Array.from(this.clients.values()).map((c) => c.close());
    this.clients.clear();
    this.inflight.clear();
    await Promise.all(closeAll);
  }

  private async connectNew(opts: McpClientOpts): Promise<McpClient> {
    const client = new McpClient(opts);
    await client.connect();
    return client;
  }
}
