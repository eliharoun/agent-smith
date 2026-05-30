import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKnowledgeManifest, loadRefreshCacheEntries } from "./parse-knowledge-manifest";

let home: string;
let cache: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "k-home-"));
  cache = await mkdtemp(join(tmpdir(), "k-cache-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

describe("loadKnowledgeManifest", () => {
  it("returns undefined when manifest missing", async () => {
    expect(await loadKnowledgeManifest("x", home)).toBeUndefined();
  });

  it("loads a populated manifest", async () => {
    const dir = join(home, "knowledge", "x");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-01-01T00:00:00Z",
        sources: [],
        totals: { tokensInline: 0, tokensInlineBudget: 0, files: 0, bytes: 0 },
      }),
    );
    const m = await loadKnowledgeManifest("x", home);
    expect(m?.schemaVersion).toBe(1);
  });
});

describe("loadRefreshCacheEntries", () => {
  it("returns {} when sources dir missing", async () => {
    expect(await loadRefreshCacheEntries("x", cache)).toEqual({});
  });

  it("loads .meta.json entries keyed by source id", async () => {
    const dir = join(cache, "agents", "x", "sources");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "src1.meta.json"),
      JSON.stringify({
        last_refreshed_at: "2026-01-01T00:00:00Z",
        last_attempt_at: "2026-01-01T00:00:00Z",
        last_error: null,
      }),
    );
    const r = await loadRefreshCacheEntries("x", cache);
    expect(r["src1"]?.last_error).toBeNull();
  });

  it("skips malformed entries", async () => {
    const dir = join(cache, "agents", "x", "sources");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.meta.json"), "garbage");
    await writeFile(
      join(dir, "good.meta.json"),
      JSON.stringify({
        last_refreshed_at: "t",
        last_attempt_at: "t",
        last_error: null,
      }),
    );
    const r = await loadRefreshCacheEntries("x", cache);
    expect(Object.keys(r)).toEqual(["good"]);
  });
});
