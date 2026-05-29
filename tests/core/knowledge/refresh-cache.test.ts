// tests/core/knowledge/refresh-cache.test.ts
//
// Unit tests for the per-source refresh-cache `.meta.json` module
// (PHASE-5 task 1, spec §9.1). The module is a pure utility:
// read/write JSON entries under
// `<cacheRoot>/agents/<agent>/sources/<sourceId>.meta.json`
// and a `cacheAgeMs` helper used by the runner to decide whether a
// source is due for a refresh.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheAgeMs,
  mergeCacheEntry,
  type RefreshCacheEntry,
  readRefreshCache,
  safeFsName,
  writeRefreshCache,
} from "../../../src/core/knowledge/refresh-cache";

describe("safeFsName", () => {
  test("leaves kebab-case agent names unchanged", () => {
    expect(safeFsName("my-agent")).toBe("my-agent");
    expect(safeFsName("source-id_v2.1")).toBe("source-id_v2.1");
  });

  test("replaces path separators and other unsafe chars with dash", () => {
    expect(safeFsName("a/b\\c@d e")).toBe("a-b-c-d-e");
    expect(safeFsName("foo/bar")).toBe("foo-bar");
  });
});

describe("refresh-cache", () => {
  test("round-trips a successful refresh entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-cache-"));
    try {
      const entry: RefreshCacheEntry = {
        schemaVersion: 1,
        last_refreshed_at: "2026-05-18T10:00:00Z",
        last_attempt_at: "2026-05-18T10:00:00Z",
        last_error: null,
        etag: 'W/"abc123"',
        last_modified: "Mon, 18 May 2026 09:59:00 GMT",
      };
      await writeRefreshCache(dir, "alpha", "src-1", entry);
      const got = await readRefreshCache(dir, "alpha", "src-1");
      expect(got).toEqual(entry);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("round-trips a failed-attempt entry (last_error set, last_refreshed_at preserved)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-cache-"));
    try {
      const entry: RefreshCacheEntry = {
        schemaVersion: 1,
        last_refreshed_at: "2026-05-18T09:00:00Z",
        last_attempt_at: "2026-05-18T10:00:00Z",
        last_error: "network unreachable",
      };
      await writeRefreshCache(dir, "alpha", "src-1", entry);
      const got = await readRefreshCache(dir, "alpha", "src-1");
      expect(got).toBeDefined();
      expect(got?.last_error).toBe("network unreachable");
      expect(got?.last_refreshed_at).toBe("2026-05-18T09:00:00Z");
      expect(got?.last_attempt_at).toBe("2026-05-18T10:00:00Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when no cache file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-cache-"));
    try {
      const got = await readRefreshCache(dir, "alpha", "src-1");
      expect(got).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined for a corrupt cache file (silent overwrite policy)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-cache-"));
    try {
      const sourcesDir = join(dir, "agents", "alpha", "sources");
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, "src-1.meta.json"), "{ not json", "utf8");
      const got = await readRefreshCache(dir, "alpha", "src-1");
      expect(got).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cacheAgeMs returns ms since last_refreshed_at", () => {
    const entry: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T10:00:00Z",
      last_attempt_at: "2026-05-18T10:00:00Z",
      last_error: null,
    };
    const now = Date.parse("2026-05-18T12:00:00Z");
    expect(cacheAgeMs(entry, now)).toBe(2 * 60 * 60 * 1000);
  });

  test("cacheAgeMs returns Infinity when entry is undefined", () => {
    expect(cacheAgeMs(undefined, Date.now())).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("mergeCacheEntry", () => {
  const NOW = "2026-05-18T10:00:00.000Z";

  test("success with no prior: both timestamps = now, last_error null, no etag/last_modified", () => {
    const got = mergeCacheEntry({ now: NOW, outcome: { ok: true } });
    expect(got).toEqual({
      schemaVersion: 1,
      last_refreshed_at: NOW,
      last_attempt_at: NOW,
      last_error: null,
    });
  });

  test("success with prior carrying etag+last_modified: timestamps advance, headers preserved", () => {
    const prior: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-17T08:00:00Z",
      last_attempt_at: "2026-05-17T08:00:00Z",
      last_error: null,
      etag: 'W/"abc"',
      last_modified: "Sun, 17 May 2026 08:00:00 GMT",
    };
    const got = mergeCacheEntry({ now: NOW, outcome: { ok: true }, prior });
    expect(got).toEqual({
      schemaVersion: 1,
      last_refreshed_at: NOW,
      last_attempt_at: NOW,
      last_error: null,
      etag: 'W/"abc"',
      last_modified: "Sun, 17 May 2026 08:00:00 GMT",
    });
  });

  test("failure with no prior: seeds last_refreshed_at to now", () => {
    const got = mergeCacheEntry({
      now: NOW,
      outcome: { ok: false, error: "boom" },
    });
    expect(got).toEqual({
      schemaVersion: 1,
      last_refreshed_at: NOW,
      last_attempt_at: NOW,
      last_error: "boom",
    });
  });

  test("failure with prior: preserves last_refreshed_at, advances last_attempt_at", () => {
    const prior: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T08:00:00Z",
      last_attempt_at: "2026-05-18T08:00:00Z",
      last_error: null,
    };
    const got = mergeCacheEntry({
      now: NOW,
      outcome: { ok: false, error: "network unreachable" },
      prior,
    });
    expect(got).toEqual({
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T08:00:00Z",
      last_attempt_at: NOW,
      last_error: "network unreachable",
    });
  });

  test("failure preserves etag/last_modified from prior", () => {
    const prior: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T08:00:00Z",
      last_attempt_at: "2026-05-18T08:00:00Z",
      last_error: null,
      etag: 'W/"xyz"',
      last_modified: "Mon, 18 May 2026 08:00:00 GMT",
    };
    const got = mergeCacheEntry({
      now: NOW,
      outcome: { ok: false, error: "503" },
      prior,
    });
    expect(got).toEqual({
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T08:00:00Z",
      last_attempt_at: NOW,
      last_error: "503",
      etag: 'W/"xyz"',
      last_modified: "Mon, 18 May 2026 08:00:00 GMT",
    });
  });

  test("does NOT emit undefined keys when prior has no etag/last_modified", () => {
    const prior: RefreshCacheEntry = {
      schemaVersion: 1,
      last_refreshed_at: "2026-05-18T08:00:00Z",
      last_attempt_at: "2026-05-18T08:00:00Z",
      last_error: null,
    };
    const success = mergeCacheEntry({ now: NOW, outcome: { ok: true }, prior });
    expect("etag" in success).toBe(false);
    expect("last_modified" in success).toBe(false);
    const failure = mergeCacheEntry({
      now: NOW,
      outcome: { ok: false, error: "x" },
      prior,
    });
    expect("etag" in failure).toBe(false);
    expect("last_modified" in failure).toBe(false);
  });
});
