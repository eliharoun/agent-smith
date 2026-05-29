// Doctor's skill-drift section. Verifies the pure orchestrator's
// classification of installed skills against their recorded content hash.
//
// All I/O is injected (loadInstalled, hashDir, pathExists). No real fs touch.

import { describe, expect, test } from "bun:test";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import { runDoctor } from "../../../src/core/freshness/run-doctor";
import type {
  DoctorDeps,
  SchemaMeta,
  ToolMapMeta,
} from "../../../src/core/freshness/types";
import type {
  InstalledSkill,
  InstalledSkillsFile,
} from "../../../src/io/installed-skills";

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://example.com/claude",
  notes: "",
};
const codexMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "https://example.com/codex",
  notes: "",
};
const schemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "https://example.com/schema",
  schemaId: null,
  version: null,
  notes: "",
};
const vendoredSchema = { properties: { agent: { type: "object" } } };

function deps(): DoctorDeps {
  const io = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-02T00:00:00.000Z"),
    readCache: io.readCache,
    writeCache: io.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
  };
}

function entry(over: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: "demo",
    sourceCatalogLabel: "test-cat",
    sourcePath: "/src/demo",
    installedPaths: { opencode: "/dest/opencode/demo" },
    contentHash: "h-recorded",
    installedAt: "2026-05-01T00:00:00.000Z",
    ...over,
  };
}

function file(installed: InstalledSkill[]): InstalledSkillsFile {
  return { schemaVersion: 1, installed };
}

describe("runDoctor: skillDrift section", () => {
  test("absent when not configured (back-compat)", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
    });
    expect(r.skillDrift).toBeUndefined();
  });

  test("empty installed-skills file → entries: []", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([]),
        hashDir: async () => "irrelevant",
        pathExists: async () => true,
      },
    });
    expect(r.skillDrift).toEqual({ entries: [] });
  });

  test("matching hash → status ok", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-recorded",
        pathExists: async () => true,
      },
    });
    expect(r.skillDrift?.entries).toEqual([
      { name: "demo", status: "ok", checkedDest: "/dest/opencode/demo" },
    ]);
  });

  test("differing hash → status drift with both hashes", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-current",
        pathExists: async () => true,
      },
    });
    expect(r.skillDrift?.entries).toEqual([
      {
        name: "demo",
        status: "drift",
        checkedDest: "/dest/opencode/demo",
        recordedHash: "h-recorded",
        currentHash: "h-current",
      },
    ]);
  });

  test("dest dir missing → status missing", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-recorded",
        // Source exists, dest doesn't.
        pathExists: async (p: string) => p === "/src/demo",
      },
    });
    expect(r.skillDrift?.entries).toEqual([
      { name: "demo", status: "missing", checkedDest: "/dest/opencode/demo" },
    ]);
  });

  test("source dir gone → status source-missing (takes precedence)", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-recorded",
        pathExists: async () => false,
      },
    });
    expect(r.skillDrift?.entries).toEqual([
      { name: "demo", status: "source-missing", sourceDir: "/src/demo" },
    ]);
  });

  test("falls back to claudeCode dest when opencode is absent", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () =>
          file([
            entry({
              installedPaths: { claudeCode: "/dest/claude/demo" },
            }),
          ]),
        hashDir: async () => "h-recorded",
        pathExists: async () => true,
      },
    });
    expect(r.skillDrift?.entries[0]).toMatchObject({
      status: "ok",
      checkedDest: "/dest/claude/demo",
    });
  });

  test("drift never bumps exit code (informational only)", async () => {
    const r = await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-current",
        pathExists: async () => true,
      },
    });
    expect(r.exitCode).toBe(0);
  });

  test("emits start/done events for the skill-drift section", async () => {
    const events: Array<{ id: string; status?: string }> = [];
    await runDoctor({
      vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps: deps(),
      onSectionStart: (e) => events.push({ id: e.id }),
      onSectionDone: (e) => events.push({ id: e.id, status: e.status }),
      skillDrift: {
        loadInstalled: async () => file([entry()]),
        hashDir: async () => "h-current",
        pathExists: async () => true,
      },
    });
    const skillEvents = events.filter((e) => e.id === "skill-drift");
    expect(skillEvents).toHaveLength(2);
    expect(skillEvents[1]?.status).toBe("warn");
  });
});
