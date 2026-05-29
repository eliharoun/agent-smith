#!/usr/bin/env bun
/**
 * MANUAL REFRESH — run `bun run refresh-schemas` and commit the diff.
 * Hermetic CI: never automate. v0.3.0 will add a `bun run check-drift`
 * script that diffs without writing; until then, run this and review
 * the diff before committing.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const SCHEMA_PATH = join("data", "opencode.config.schema.json");
const META_PATH = join("data", "opencode.config.schema.meta.json");

async function main(): Promise<number> {
  console.log(`Fetching ${OPENCODE_SCHEMA_URL}...`);
  let resp: Response;
  try {
    resp = await fetch(OPENCODE_SCHEMA_URL);
  } catch (err) {
    console.error(`Fetch failed: ${(err as Error).message}`);
    return 1;
  }
  if (!resp.ok) {
    console.error(`Fetch failed: HTTP ${resp.status}`);
    return 1;
  }
  const schema = (await resp.json()) as Record<string, unknown>;
  await writeFile(SCHEMA_PATH, `${JSON.stringify(schema, null, 2)}\n`);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const schemaId = schema.$id ?? null;
  const version = schema.version ?? null;
  const meta = {
    lastVerifiedDate: today,
    sourceUrl: OPENCODE_SCHEMA_URL,
    schemaId,
    version,
    notes:
      "Refreshed via `bun run refresh-schemas`. Review the diff against the prior commit and update CHANGELOG/MIGRATION if any agent-facing schema fields changed.",
  };
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`Wrote ${SCHEMA_PATH}`);
  console.log(`Wrote ${META_PATH}`);
  console.log(`Schema $id: ${schemaId ?? "(none)"}, version: ${version ?? "(none)"}`);
  console.log(`lastVerifiedDate: ${today}`);
  return 0;
}

process.exit(await main());
