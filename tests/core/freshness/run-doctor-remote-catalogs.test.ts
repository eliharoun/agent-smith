// tests/core/freshness/run-doctor-remote-catalogs.test.ts
//
// C3.14 (v1-task): integration test — feeds runDoctor a registry with
// remote-backed catalogs and asserts the `remote-catalogs` section
// produces the expected sub-report and emits the right section events.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import { runDoctor } from "../../../src/core/freshness/run-doctor";
import type {
  DoctorSectionDoneEvent,
  DoctorSectionStartEvent,
} from "../../../src/core/freshness/run-doctor";
import type { DoctorDeps, SchemaMeta, ToolMapMeta } from "../../../src/core/freshness/types";
import { saveRegistry } from "../../../src/io/registry";
import { saveSkillRegistry } from "../../../src/io/skill-registry";

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "x",
  notes: "",
};
const codexMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "x",
  notes: "",
};
const schemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "x",
  schemaId: null,
  version: null,
  notes: "",
};
const vendoredSchema = { properties: { agent: { type: "object" } } };

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  const cacheIO = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-25T00:00:00.000Z"),
    readCache: cacheIO.readCache,
    writeCache: cacheIO.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
    ...over,
  };
}

describe("runDoctor remote-catalogs section [v1-task C3.14]", () => {
  test("emits remote-catalogs section with finding when catalog is behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "doctor-remote-cat-"));
    const regPath = join(dir, "registry.json");
    const skillPath = join(dir, "skill-catalogs.json");
    try {
      await saveRegistry(regPath, {
        schemaVersion: 2,
        sources: [
          {
            kind: "registered",
            rootPath: "/clone/a",
            label: "owner/a",
            gitRemote: "https://example.com/a.git",
            remote: {
              url: "https://example.com/a.git",
              ref: "main",
              lastPulledSha: "a".repeat(40),
              lastPulledAt: "2026-05-25T00:00:00Z",
              lastRemoteSha: "b".repeat(40), // drift
              lastCheckedAt: "2026-05-25T00:00:00Z",
            },
          },
        ],
      });
      await saveSkillRegistry(skillPath, { schemaVersion: 2, catalogs: [] });

      const startEvents: DoctorSectionStartEvent[] = [];
      const doneEvents: DoctorSectionDoneEvent[] = [];
      const report = await runDoctor({
        vendoredSchema,
        schemaMeta,
        claudeMeta,
        codexMeta,
        deps: deps(),
        remoteCatalogs: {
          registryPath: regPath,
          skillRegistryPath: skillPath,
          now: () => new Date("2026-05-25T00:00:00Z"),
        },
        onSectionStart: (e) => startEvents.push(e),
        onSectionDone: (e) => doneEvents.push(e),
      });

      expect(report.remoteCatalogs).toBeDefined();
      expect(report.remoteCatalogs?.findings).toHaveLength(1);
      expect(report.remoteCatalogs?.findings[0]?.finding).toBe(
        "catalog-behind-remote",
      );

      const start = startEvents.find((e) => e.id === "remote-catalogs");
      const done = doneEvents.find((e) => e.id === "remote-catalogs");
      expect(start?.label).toBe("Remote catalogs");
      expect(done?.status).toBe("warn");
      expect(done?.summary).toContain("behind");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("section omitted from report when remoteCatalogs input is missing", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(report.remoteCatalogs).toBeUndefined();
  });
});
