import { describe, expect, test } from "bun:test";
import { isCacheFresh, makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import type { SchemaCache } from "../../../src/core/freshness/types";

describe("isCacheFresh", () => {
  test("returns true when fetchedAt is within ttlMs", () => {
    const cache: SchemaCache = { fetchedAt: "2026-05-01T12:00:00.000Z", schema: {} };
    const now = new Date("2026-05-01T18:00:00.000Z"); // 6 hours later
    const ttl = 24 * 60 * 60 * 1000; // 24 hours
    expect(isCacheFresh(cache, now, ttl)).toBe(true);
  });

  test("returns false when fetchedAt is older than ttlMs", () => {
    const cache: SchemaCache = { fetchedAt: "2026-04-30T12:00:00.000Z", schema: {} };
    const now = new Date("2026-05-02T12:00:00.000Z"); // 48 hours later
    expect(isCacheFresh(cache, now, 24 * 60 * 60 * 1000)).toBe(false);
  });

  test("returns false when cache is null", () => {
    expect(isCacheFresh(null, new Date(), 1000)).toBe(false);
  });

  test("treats malformed fetchedAt as not fresh", () => {
    const cache: SchemaCache = { fetchedAt: "not-a-date", schema: {} };
    expect(isCacheFresh(cache, new Date(), 1000)).toBe(false);
  });

  test("treats age exactly equal to ttlMs as not fresh", () => {
    const cache: SchemaCache = { fetchedAt: "2026-05-01T12:00:00.000Z", schema: {} };
    const now = new Date("2026-05-01T12:00:01.000Z");
    expect(isCacheFresh(cache, now, 1000)).toBe(false);
  });
});

describe("makeMemoryCacheIO", () => {
  test("read returns null when no value has been written", async () => {
    const io = makeMemoryCacheIO();
    expect(await io.readCache("anywhere")).toBeNull();
  });

  test("read returns what write stored, keyed by path", async () => {
    const io = makeMemoryCacheIO();
    const value: SchemaCache = { fetchedAt: "2026-05-01T00:00:00.000Z", schema: { x: 1 } };
    await io.writeCache("/tmp/a.json", value);
    expect(await io.readCache("/tmp/a.json")).toEqual(value);
    expect(await io.readCache("/tmp/b.json")).toBeNull();
    const updated: SchemaCache = { fetchedAt: "2026-05-02T00:00:00.000Z", schema: { x: 2 } };
    await io.writeCache("/tmp/a.json", updated);
    expect(await io.readCache("/tmp/a.json")).toEqual(updated);
  });

  test("read returns null on corrupted JSON (the in-memory store's parseError simulation)", async () => {
    const io = makeMemoryCacheIO();
    io.simulateCorrupted("/tmp/c.json");
    expect(await io.readCache("/tmp/c.json")).toBeNull();
  });
});
