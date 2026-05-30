/**
 * Per-resource lock manager. Keys are opaque strings; convention is:
 *   - `agent:<name>`
 *   - `skill:<name>`
 *   - `catalog:<label>`
 *   - `knowledge:<agent>` (held by knowledge.add / knowledge.fetch — composed
 *     with `agent:<name>` since both shell out to `agent install`)
 *   - `global:agents` | `global:skills` | `global:catalogs` | `global:init`
 *   - `global:doctor` (advisory; doctor never acquires — listed for grep-ability)
 *   - `workspace` (held by `update`, `knowledge.migrate-codex`, and `jack-out`)
 *   - `daemon` (held by `daemon.start` / `daemon.stop` / `jack-out`)
 *   - `all-agents` (wildcard: conflicts with any `agent:*` lock — held only
 *     by `jack-out`). See `lock-policy.md` for the full conflict matrix.
 *
 * Doctor may run concurrently with anything else, so callers simply do not
 * acquire locks for it.
 */
export class LockManager {
  private readonly heldBy = new Map<string, string>(); // key -> jobId
  private readonly keysByJob = new Map<string, Set<string>>(); // jobId -> keys

  tryAcquire(key: string, jobId: string): boolean {
    if (this.heldBy.has(key)) return false;
    this.heldBy.set(key, jobId);
    const set = this.keysByJob.get(jobId) ?? new Set();
    set.add(key);
    this.keysByJob.set(jobId, set);
    return true;
  }

  tryAcquireMany(keys: string[], jobId: string): boolean {
    // Phase 3 policy: `all-agents` is a wildcard that conflicts with every
    // `agent:*` lock (and vice versa). Reject before any partial acquisition
    // so we can never leave a stale lock around on failure.
    for (const k of keys) {
      if (k === "all-agents") {
        for (const existing of this.heldBy.keys()) {
          if (existing.startsWith("agent:")) return false;
        }
      } else if (k.startsWith("agent:")) {
        if (this.heldBy.has("all-agents")) return false;
      }
      if (this.heldBy.has(k)) return false;
    }
    for (const k of keys) this.tryAcquire(k, jobId);
    return true;
  }

  release(jobId: string): void {
    const keys = this.keysByJob.get(jobId);
    if (!keys) return;
    for (const k of keys) this.heldBy.delete(k);
    this.keysByJob.delete(jobId);
  }

  holderOf(key: string): string | undefined {
    // For introspection: report the `all-agents` holder when asked for any
    // `agent:*` key (so the 409 error message points to the actual culprit).
    if (key.startsWith("agent:") && this.heldBy.has("all-agents")) {
      return this.heldBy.get("all-agents");
    }
    if (key === "all-agents") {
      for (const [k, v] of this.heldBy) {
        if (k.startsWith("agent:")) return v;
      }
    }
    return this.heldBy.get(key);
  }
}
