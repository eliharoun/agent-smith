#!/usr/bin/env bun
// scripts/check-drift.ts
/**
 * Maintainer script. Diffs the live OpenCode schema against the vendored
 * copy WITHOUT writing anything. Use this before deciding whether to run
 * `bun run refresh-schemas`.
 *
 * Exit codes match `smith doctor`:
 *   0 = no drift
 *   1 = drift detected
 *   2 = network failure
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { diffSchemas } from "../src/core/freshness/diff";

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const SCHEMA_PATH = join("data", "opencode.config.schema.json");
const META_PATH = join("data", "opencode.config.schema.meta.json");

export interface CheckDriftOptions {
  vendored: Record<string, unknown>;
  fetch: (url: string) => Promise<Response>;
  print: (s: string) => void;
  printErr?: (s: string) => void;
  vendoredDate: string;
  /** OpenCode schema URL. Defaults to `OPENCODE_SCHEMA_URL`. */
  url?: string;
}

/**
 * Diff a vendored OpenCode schema against a live one fetched over HTTP and
 * print a structural summary suitable for a maintainer's review.
 *
 * Pure with respect to I/O: every side-effect goes through `opts` (fetch,
 * print, printErr) so the function is fully testable without network or
 * filesystem access.
 *
 * Exit-code contract (returned, not thrown):
 *   0 — no structural drift; the maintainer doesn't need to refresh.
 *   1 — drift detected; printed full added/removed/changed lists.
 *   2 — operational failure (network error, non-2xx HTTP, malformed JSON,
 *       or non-object JSON body). The label in the printErr line
 *       distinguishes the cause: `Fetch failed:` (transport/HTTP),
 *       `Parse failed:` (200 OK but body unparseable), or
 *       `Upstream returned non-object JSON` (parsed but wrong shape).
 */
export async function runCheckDrift(opts: CheckDriftOptions): Promise<number> {
  const printErr = opts.printErr ?? ((s) => console.error(s));
  const url = opts.url ?? OPENCODE_SCHEMA_URL;
  let live: Record<string, unknown>;
  let resp: Response;
  try {
    resp = await opts.fetch(url);
  } catch (err) {
    printErr(`Fetch failed: ${(err as Error).message}`);
    return 2;
  }
  if (!resp.ok) {
    printErr(`Fetch failed: HTTP ${resp.status}`);
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = await resp.json();
  } catch (err) {
    printErr(`Parse failed: ${(err as Error).message}`);
    return 2;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    printErr(`Upstream returned non-object JSON (got ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed})`);
    return 2;
  }
  live = parsed as Record<string, unknown>;

  const drift = diffSchemas(opts.vendored, live);
  const total = drift.added.length + drift.removed.length + drift.changed.length;

  if (total === 0) {
    opts.print(`OpenCode schema unchanged since ${opts.vendoredDate}.`);
    return 0;
  }

  opts.print(`DRIFT DETECTED: ${drift.headline}`);
  // No truncation: maintainer wants the full list to size the review.
  if (drift.added.length > 0) {
    opts.print(`\nAdded:`);
    for (const p of drift.added) opts.print(`  + ${p}`);
  }
  if (drift.removed.length > 0) {
    opts.print(`\nRemoved:`);
    for (const p of drift.removed) opts.print(`  - ${p}`);
  }
  if (drift.changed.length > 0) {
    opts.print(`\nChanged:`);
    for (const p of drift.changed) opts.print(`  ~ ${p}`);
  }
  opts.print(`\nNext step: review the diff, then run \`bun run refresh-schemas\` to accept.`);
  return 1;
}

/**
 * Check the vendored kiro schema (data/kiro.agent-v1.schema.json) against
 * the live upstream schema. Filters knownDivergences from the meta file so
 * documented schema/runtime gaps (e.g. the resources field's ^(file://)
 * pattern that the runtime relaxes for skill:// URIs) don't false-positive.
 *
 * Returns the same exit code semantics as runCheckDrift:
 *   0 = no drift, 1 = drift detected, 2 = operational failure.
 */
export interface CheckKiroDriftOptions {
  vendored: Record<string, unknown>;
  meta: {
    sourceUrl: string;
    lastVerifiedDate: string;
    knownDivergences: Array<{ field: string; schema?: string; runtime?: string; smithBehavior?: string }>;
  };
  fetch: (url: string) => Promise<Response>;
  print: (s: string) => void;
  printErr?: (s: string) => void;
}

export async function runCheckKiroDrift(opts: CheckKiroDriftOptions): Promise<number> {
  const printErr = opts.printErr ?? ((s) => console.error(s));
  let resp: Response;
  try {
    resp = await opts.fetch(opts.meta.sourceUrl);
  } catch (err) {
    printErr(`[kiro] Fetch failed: ${(err as Error).message}`);
    return 2;
  }
  if (!resp.ok) {
    printErr(`[kiro] Upstream returned ${resp.status}`);
    return 2;
  }
  let live: Record<string, unknown>;
  try {
    live = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    printErr(`[kiro] Parse failed: ${(err as Error).message}`);
    return 2;
  }

  // Compare top-level property keys, filtering knownDivergences.
  const vProps = (opts.vendored.properties as Record<string, unknown> | undefined) ?? {};
  const lProps = (live.properties as Record<string, unknown> | undefined) ?? {};
  const knownFields = new Set(opts.meta.knownDivergences.map((d) => d.field));
  const drift: string[] = [];
  for (const key of Object.keys(lProps)) {
    if (knownFields.has(key)) continue;
    if (!(key in vProps)) drift.push(`new field '${key}' in live schema`);
  }
  for (const key of Object.keys(vProps)) {
    if (knownFields.has(key)) continue;
    if (!(key in lProps)) drift.push(`field '${key}' removed from live schema`);
  }

  if (drift.length === 0) {
    opts.print(`[kiro] schema in sync with upstream (vendored ${opts.meta.lastVerifiedDate})`);
    return 0;
  }
  opts.print(`[kiro] schema drift detected (vendored ${opts.meta.lastVerifiedDate}):`);
  for (const d of drift) opts.print(`  ${d}`);
  opts.print(`  Update data/kiro.agent-v1.schema.json + data/kiro.agent-v1.schema.meta.json`);
  return 1;
}

// Entry point when run directly (not under test).
if (import.meta.main) {
  let vendored: Record<string, unknown>;
  let meta: { lastVerifiedDate: string; sourceUrl?: string };
  try {
    vendored = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as Record<string, unknown>;
    meta = JSON.parse(await readFile(META_PATH, "utf8")) as {
      lastVerifiedDate: string;
      sourceUrl?: string;
    };
  } catch (err) {
    console.error(`Failed to read vendored schema/meta from ${SCHEMA_PATH} or ${META_PATH}: ${(err as Error).message}`);
    process.exit(2);
  }
  const opencodeCode = await runCheckDrift({
    vendored,
    ...(meta.sourceUrl !== undefined ? { url: meta.sourceUrl } : {}),
    fetch: (url) => fetch(url),
    print: (s) => console.log(s),
    vendoredDate: meta.lastVerifiedDate,
  });

  // Kiro schema drift check. Vendored schema lives at
  // data/kiro.agent-v1.schema.json; meta at data/kiro.agent-v1.schema.meta.json.
  const KIRO_SCHEMA_PATH = join("data", "kiro.agent-v1.schema.json");
  const KIRO_META_PATH = join("data", "kiro.agent-v1.schema.meta.json");
  let kiroVendored: Record<string, unknown>;
  let kiroMeta: {
    sourceUrl: string;
    lastVerifiedDate: string;
    knownDivergences: Array<{ field: string }>;
  };
  let kiroCode = 0;
  try {
    kiroVendored = JSON.parse(await readFile(KIRO_SCHEMA_PATH, "utf8")) as Record<string, unknown>;
    kiroMeta = JSON.parse(await readFile(KIRO_META_PATH, "utf8")) as typeof kiroMeta;
    kiroCode = await runCheckKiroDrift({
      vendored: kiroVendored,
      meta: kiroMeta,
      fetch: (url) => fetch(url),
      print: (s) => console.log(s),
    });
  } catch (err) {
    console.error(
      `Failed to read vendored kiro schema/meta from ${KIRO_SCHEMA_PATH} or ${KIRO_META_PATH}: ${(err as Error).message}`,
    );
    kiroCode = 2;
  }

  // Aggregate exit code: prefer drift (1) over operational failure (2)
  // over success (0) so a CI run flagging real drift in either schema
  // doesn't get masked by a transient network failure in the other.
  process.exit(opencodeCode === 1 || kiroCode === 1 ? 1 : Math.max(opencodeCode, kiroCode));
}
