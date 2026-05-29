// tests/daemon/refresh-loop.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRefreshCache } from "../../src/core/knowledge/refresh-cache";
import { type TickInput, tickRefreshLoop } from "../../src/daemon/refresh-loop";

const now = Date.parse("2026-05-18T12:00:00Z");

describe("tickRefreshLoop", () => {
  test("refreshes a source whose cache age >= declared ttl", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "refresh-loop-"));
    try {
      // Cache from 2 hours ago
      await writeRefreshCache(cacheRoot, "a", "s1", {
        schemaVersion: 1,
        last_refreshed_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        last_attempt_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        last_error: null,
      });
      const calls: string[] = [];
      const input: TickInput = {
        now,
        cacheRoot,
        agents: [
          {
            name: "a",
            sources: [{ id: "s1", ttlMs: 60 * 60 * 1000 /* 1h */ }],
          },
        ],
        refreshSource: async (agent, sourceId) => {
          calls.push(`${agent}/${sourceId}`);
          return { ok: true };
        },
      };
      const result = await tickRefreshLoop(input);
      expect(calls).toEqual(["a/s1"]);
      expect(result.refreshed).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test("skips a source whose cache is fresher than ttl", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "refresh-loop-"));
    try {
      await writeRefreshCache(cacheRoot, "a", "s1", {
        schemaVersion: 1,
        last_refreshed_at: new Date(now - 30 * 60 * 1000).toISOString(), // 30min
        last_attempt_at: new Date(now - 30 * 60 * 1000).toISOString(),
        last_error: null,
      });
      const calls: string[] = [];
      const result = await tickRefreshLoop({
        now,
        cacheRoot,
        agents: [
          {
            name: "a",
            sources: [{ id: "s1", ttlMs: 60 * 60 * 1000 }],
          },
        ],
        refreshSource: async (a, s) => {
          calls.push(`${a}/${s}`);
          return { ok: true };
        },
      });
      expect(calls).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe("fresh");
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test("refreshes a never-cached source on first tick", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "refresh-loop-"));
    try {
      const calls: string[] = [];
      const result = await tickRefreshLoop({
        now,
        cacheRoot,
        agents: [
          {
            name: "a",
            sources: [{ id: "s1", ttlMs: 60 * 60 * 1000 }],
          },
        ],
        refreshSource: async (a, s) => {
          calls.push(`${a}/${s}`);
          return { ok: true };
        },
      });
      expect(calls).toEqual(["a/s1"]);
      expect(result.refreshed).toHaveLength(1);
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test("failed refresh recorded in result; doesn't crash the tick", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "refresh-loop-"));
    try {
      const result = await tickRefreshLoop({
        now,
        cacheRoot,
        agents: [
          {
            name: "a",
            sources: [{ id: "s1", ttlMs: 60 * 60 * 1000 }],
          },
        ],
        refreshSource: async () => ({ ok: false, error: "boom" }),
      });
      expect(result.refreshed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.error).toBe("boom");
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
