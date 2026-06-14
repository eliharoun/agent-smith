/**
 * End-to-end CLI coverage for `smith doctor`'s knowledge-index section and
 * `--fix-knowledge-index` auto-repair.
 *
 * Detector classifies each registered bundle with ≥1 knowledge source:
 *   - stale-index:   index DB present but unusable at the current schema.
 *                    Auto-repaired by --fix-knowledge-index (buildIndexInto).
 *   - missing-index: sources materialized, no index DB. SUGGEST-ONLY — never
 *                    auto-built (the user runs `smith agent install <agent>`).
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import { parseConfig } from "../../src/core/config-schema";
import { indexDbPath } from "../../src/core/knowledge/index/index-paths";
import { KnowledgeStore } from "../../src/core/knowledge/index/store";
import { runKnowledgeStage } from "../../src/core/knowledge/pipeline";
import type { AgentBundle } from "../../src/core/types";
import type { PlatformId } from "../../src/io/platform-detect";

const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);

let root: string;
let agentSmithHome: string;
let bundlesRoot: string;
let schemaCachePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smith-doctor-ki-"));
  agentSmithHome = join(root, "agent-smith-home");
  bundlesRoot = join(root, "bundles");
  schemaCachePath = join(root, "schema-cache.json");
  await mkdir(agentSmithHome, { recursive: true });
  await mkdir(bundlesRoot, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeBundle(name: string): Promise<AgentBundle> {
  const bundleDir = join(bundlesRoot, name);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "doc.md"), "# Doc\n\nrate limiting in the gateway\n", "utf8");
  const configRaw: Record<string, unknown> = {
    name,
    description: `Use to test ${name}.`,
    targets: ["opencode"],
    modelTier: "balanced",
    knowledge: {
      sources: [
        {
          id: "doc",
          type: "file",
          path: "./doc.md",
          delivery: "file",
          description: `Doc for ${name}`,
        },
      ],
    },
  };
  const parsed = parseConfig(configRaw);
  if (!parsed.success) throw new Error(`fixture invalid: ${parsed.errors.join("; ")}`);
  await writeFile(join(bundleDir, "agent.config.json"), JSON.stringify(configRaw, null, 2));
  return {
    config: parsed.data,
    source: { kind: "user-global", rootPath: bundlesRoot, label: "test" },
    bundlePath: bundleDir,
    files: { identity: "", expertise: "", soul: "", user: "" },
  };
}

/** Materialize a bundle's knowledge (also builds a healthy lexical index). */
async function materialize(bundle: AgentBundle): Promise<string> {
  const knowledgeDir = join(agentSmithHome, "knowledge", bundle.config.name);
  await runKnowledgeStage(bundle.config.knowledge, {
    bundleDir: bundle.bundlePath,
    knowledgeDir,
    cacheDir: join(root, "cache", bundle.config.name),
  });
  return knowledgeDir;
}

/** Overwrite the index DB at `knowledgeDir` with a stale schema-1 image. */
async function plantStaleIndex(knowledgeDir: string): Promise<void> {
  const dbp = indexDbPath(knowledgeDir);
  await rm(dbp, { force: true });
  await rm(`${dbp}-wal`, { force: true });
  await rm(`${dbp}-shm`, { force: true });
  await mkdir(join(knowledgeDir, ".cache", "index"), { recursive: true });
  const raw = new Database(dbp, { create: true });
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec(
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);" +
      "CREATE TABLE chunks (id TEXT PRIMARY KEY, source_id TEXT, rel_path TEXT, start_line INTEGER, end_line INTEGER, kind TEXT, text TEXT, content_hash TEXT, embedding BLOB);",
  );
  raw.query("INSERT INTO meta(key,value) VALUES(?,?)").run("schemaVersion", "1");
  raw.close();
}

async function runDoctor(opts: {
  bundles: AgentBundle[];
  fix?: boolean;
}): Promise<{ stdout: string; report: any }> {
  const lines: string[] = [];
  await runDoctorCli({
    detectInstalledPlatforms: allPlatforms,
    offline: true,
    noCache: false,
    json: true,
    skipModelResolution: true,
    cachePath: schemaCachePath,
    print: (s: string) => lines.push(s),
    knowledgeIndex: { agentSmithHome, loadAllBundles: async () => opts.bundles },
    fixKnowledgeIndex: opts.fix === true,
  });
  const stdout = lines.join("\n");
  const jsonLine = lines.filter((l) => l.trim().startsWith("{")).pop() ?? "{}";
  return { stdout, report: JSON.parse(jsonLine) };
}

async function indexUsable(knowledgeDir: string): Promise<boolean> {
  const s = await KnowledgeStore.open(
    indexDbPath(knowledgeDir),
    {
      schemaVersion: 2,
      embedders: [],
      chunkerVersion: 1,
      modelPolicyVersion: 1,
      repomapVersion: 1,
    },
    { readonly: true },
  );
  if (!s) return false;
  s.close();
  return true;
}

test("detects a stale-index finding for an incompatible on-disk DB", async () => {
  const b = await makeBundle("stale-agent");
  const kd = await materialize(b);
  await plantStaleIndex(kd);

  const { report } = await runDoctor({ bundles: [b] });
  expect(report.knowledgeIndex.findings).toEqual([{ kind: "stale-index", agent: "stale-agent" }]);
});

test("--fix-knowledge-index rebuilds a stale index (usable afterward, finding cleared)", async () => {
  const b = await makeBundle("stale-agent");
  const kd = await materialize(b);
  await plantStaleIndex(kd);
  expect(await indexUsable(kd)).toBe(false); // precondition: stale

  const { report } = await runDoctor({ bundles: [b], fix: true });
  expect(await indexUsable(kd)).toBe(true); // rebuilt to current schema
  expect(report.knowledgeIndex.findings).toEqual([]); // re-run detection is clean
});

test("missing-index is reported but NOT auto-built by --fix-knowledge-index", async () => {
  const b = await makeBundle("missing-agent");
  const kd = await materialize(b);
  // Remove the index DB but keep materialized sources + manifest.
  await rm(join(kd, ".cache"), { recursive: true, force: true });
  expect(existsSync(indexDbPath(kd))).toBe(false);

  // Detection: missing-index.
  const before = await runDoctor({ bundles: [b] });
  expect(before.report.knowledgeIndex.findings).toEqual([
    { kind: "missing-index", agent: "missing-agent" },
  ]);

  // --fix must NOT create the DB; finding persists, suggestion printed.
  const after = await runDoctor({ bundles: [b], fix: true });
  expect(existsSync(indexDbPath(kd))).toBe(false);
  expect(after.report.knowledgeIndex.findings).toEqual([
    { kind: "missing-index", agent: "missing-agent" },
  ]);
  expect(after.stdout).toContain("smith agent install missing-agent");
});
