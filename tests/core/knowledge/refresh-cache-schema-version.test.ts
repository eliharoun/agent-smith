// tests/core/knowledge/refresh-cache-schema-version.test.ts
//
// B11.6 (v1-task): per-source refresh-cache entries gain a
// `schemaVersion: 1` field. Greenfield — no pre-existing version field.
// Writers emit it; readers tolerate legacy entries via lazy in-memory
// migration. mergeCacheEntry emits schemaVersion on the merged result.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RefreshCacheEntry,
  mergeCacheEntry,
  readRefreshCache,
  writeRefreshCache,
} from "../../../src/core/knowledge/refresh-cache";

describe("RefreshCacheEntry schemaVersion [v1-task B11.6]", () => {
  test("RefreshCacheEntry type includes schemaVersion: 1", () => {
    const e: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-24T00:00:00Z",
      last_attempt_at: "2026-05-24T00:00:00Z",
      last_error: null,
    };
    expect(e.schemaVersion).toBe(1);
  });

  test("writeRefreshCache then readRefreshCache round-trips schemaVersion", async () => {
    const root = await mkdtemp(join(tmpdir(), "rc-sv-"));
    try {
      const entry: RefreshCacheEntry = {
        schemaVersion: 1,
        last_refreshed_at: "2026-05-24T00:00:00Z",
        last_attempt_at: "2026-05-24T00:00:00Z",
        last_error: null,
      };
      await writeRefreshCache(root, "my-agent", "src1", entry);
      const round = await readRefreshCache(root, "my-agent", "src1");
      expect(round?.schemaVersion).toBe(1);
      const raw = JSON.parse(
        await readFile(
          join(root, "agents", "my-agent", "sources", "src1.meta.json"),
          "utf8",
        ),
      );
      expect(raw.schemaVersion).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("readRefreshCache tolerates legacy entry with no schemaVersion (injects 1)", async () => {
    const root = await mkdtemp(join(tmpdir(), "rc-sv-legacy-"));
    try {
      const path = join(root, "agents", "a", "sources", "s.meta.json");
      await mkdir(join(root, "agents", "a", "sources"), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          last_refreshed_at: "2026-05-20T00:00:00Z",
          last_attempt_at: "2026-05-20T00:00:00Z",
          last_error: null,
        }),
        "utf8",
      );
      const read = await readRefreshCache(root, "a", "s");
      expect(read?.schemaVersion).toBe(1);
      expect(read?.last_error).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("mergeCacheEntry emits schemaVersion: 1 on success path", () => {
    const merged = mergeCacheEntry({
      now: "2026-05-24T01:00:00Z",
      outcome: { ok: true },
    });
    expect(merged.schemaVersion).toBe(1);
  });

  test("mergeCacheEntry emits schemaVersion: 1 on failure path", () => {
    const merged = mergeCacheEntry({
      now: "2026-05-24T01:00:00Z",
      outcome: { ok: false, error: "boom" },
    });
    expect(merged.schemaVersion).toBe(1);
  });
});
