/**
 * Regression guard for the install → GUI lastRefreshAt loop.
 *
 * Asserts that when both `_manifest.json` (under agentSmithHome) and the
 * per-source `.meta.json` (under cacheRoot) exist with the layout the
 * orchestrator now writes (see
 * `src/io/orchestrator.ts` post Commit 2), `buildRefreshSummary`
 * surfaces `lastRefreshAt` for the agent — the data the GUI uses to
 * render "last refreshed N minutes ago" instead of "never refreshed".
 *
 * Previously the orchestrator wrote `_manifest.json` but never the
 * per-source meta, leaving `lastRefreshAt` undefined on fresh installs.
 * This test guards that bug from regressing.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRefreshSummary } from "./refresh-summary";

let home: string;
let smithHome: string;
let cacheRoot: string;
let registryPath: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "refresh-summary-"));
  smithHome = join(home, "smith-home");
  cacheRoot = join(home, "cache");
  registryPath = join(home, "registry.json");

  // Registered agent bundle.
  const agentRoot = join(home, "agents");
  const bundle = join(agentRoot, "alpha");
  await mkdir(bundle, { recursive: true });
  await writeFile(
    join(bundle, "agent.config.json"),
    JSON.stringify({
      name: "alpha",
      knowledge: {
        sources: [
          { id: "src-1", type: "file", path: "./a.md" },
          { id: "src-2", type: "file", path: "./b.md" },
        ],
      },
    }),
  );
  await writeFile(
    registryPath,
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "test" }],
    }),
  );
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("buildRefreshSummary: install → GUI lastRefreshAt regression guard", () => {
  it("surfaces lastRefreshAt when orchestrator-style fixtures exist on disk", async () => {
    // Mirror the EXACT on-disk layout the orchestrator now produces:
    //   - <smithHome>/knowledge/<agent>/_manifest.json
    //   - <cacheRoot>/agents/<agent>/sources/<sourceId>.meta.json
    const manifestDir = join(smithHome, "knowledge", "alpha");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-21T10:00:00Z",
        sources: [
          { id: "src-1", type: "file", files: [], tokensInline: 50 },
          { id: "src-2", type: "file", files: [], tokensInline: 50 },
        ],
        totals: {
          tokensInline: 100,
          tokensInlineBudget: 1000,
          files: 0,
          bytes: 0,
        },
      }),
    );

    const cacheDir = join(cacheRoot, "agents", "alpha", "sources");
    await mkdir(cacheDir, { recursive: true });
    const newerTs = "2026-05-21T10:00:00Z";
    const olderTs = "2026-05-21T09:00:00Z";
    await writeFile(
      join(cacheDir, "src-1.meta.json"),
      JSON.stringify({
        last_refreshed_at: olderTs,
        last_attempt_at: olderTs,
        last_error: null,
      }),
    );
    await writeFile(
      join(cacheDir, "src-2.meta.json"),
      JSON.stringify({
        last_refreshed_at: newerTs,
        last_attempt_at: newerTs,
        last_error: null,
      }),
    );

    const summaries = await buildRefreshSummary({
      registryPath,
      agentSmithHome: smithHome,
      cacheRoot,
    });

    expect(summaries.length).toBe(1);
    const alpha = summaries[0];
    expect(alpha?.agent).toBe("alpha");
    expect(alpha?.sourceCount).toBe(2);
    expect(alpha?.failingCount).toBe(0);
    // Max across the two per-source entries — proves the GUI saw BOTH
    // meta files the orchestrator now writes, not just _manifest.json.
    expect(alpha?.lastRefreshAt).toBe(newerTs);
  });

  it("omits lastRefreshAt when manifest exists but no meta files were written", async () => {
    // The buggy state pre-Commit 2: _manifest.json present, but no .meta.json.
    // Documents the symptom we're guarding against.
    const manifestDir = join(smithHome, "knowledge", "alpha");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-21T10:00:00Z",
        sources: [{ id: "src-1", type: "file", files: [], tokensInline: 50 }],
        totals: {
          tokensInline: 50,
          tokensInlineBudget: 1000,
          files: 0,
          bytes: 0,
        },
      }),
    );

    const summaries = await buildRefreshSummary({
      registryPath,
      agentSmithHome: smithHome,
      cacheRoot,
    });

    expect(summaries[0]?.agent).toBe("alpha");
    expect(summaries[0]?.lastRefreshAt).toBeUndefined();
  });
});
