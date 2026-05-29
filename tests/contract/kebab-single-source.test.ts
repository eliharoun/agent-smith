import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { KEBAB_AGENT_NAME } from "../../src/cli/agent-name";
import { KEBAB } from "../../src/core/kebab";

/**
 * Contract test: there is exactly ONE definition of the kebab-case
 * identifier regex in src/. All other sites must import it.
 *
 * Background: the regex `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` validates
 * agent names and knowledge-source ids. Prior to v0.24, three files
 * (src/cli/agent-name.ts, src/core/config-schema.ts,
 * src/core/knowledge/schema.ts) each defined their own copy of this
 * literal. A header comment said "MUST stay in sync" but nothing
 * enforced it — a silent divergence between the CLI-arg validator and
 * the config-time validator would create a security gap (a name the
 * CLI accepts but the schema rejects, or vice versa).
 *
 * This test prevents that by:
 *   1. Asserting that `KEBAB_AGENT_NAME` (the CLI-public name) and
 *      `KEBAB` (the schema-canonical name) are the SAME RegExp object.
 *   2. Scanning every .ts file under src/ for the literal regex pattern
 *      and failing if more than one file contains it.
 *
 * If you need to change the pattern, change it in src/core/kebab.ts
 * — the canonical site — and the change automatically applies everywhere.
 *
 * Tracked under v1 task B2 (docs/2026-05-22-road-to-v1-checklist.md).
 */
describe("KEBAB single source of truth", () => {
  test("KEBAB_AGENT_NAME is the same RegExp object as KEBAB", () => {
    expect(KEBAB_AGENT_NAME).toBe(KEBAB);
  });

  test("KEBAB_AGENT_NAME and KEBAB have identical source", () => {
    // Defense in depth: even if someone reassigns one without changing
    // the identity test, source-equality catches drift.
    expect(KEBAB_AGENT_NAME.source).toBe(KEBAB.source);
  });

  test("the regex literal appears in exactly one file under src/", async () => {
    const srcRoot = join(import.meta.dir, "..", "..", "src");
    const literal = "/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/";
    const hits: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const source = await readFile(full, "utf-8");
          if (source.includes(literal)) {
            hits.push(relative(srcRoot, full));
          }
        }
      }
    }

    await walk(srcRoot);

    expect(hits).toEqual(["core/kebab.ts"]);
  });
});
