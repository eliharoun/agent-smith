import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../../src/core/freshness/run-doctor";
import type { SchemaMeta, ToolMapMeta } from "../../src/core/freshness/types";

const stubSchemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "https://example",
  schemaId: null,
  version: null,
  notes: "",
};
const stubToolMapMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-05-01",
  verifiedAgainstVersion: "x",
  sourceUrl: "https://example",
  notes: "",
};
const stubDeps = {
  fetch: () => Promise.reject(new Error("not used")),
  now: () => new Date("2026-05-01T00:00:00Z"),
  readCache: async () => null,
  writeCache: async () => {},
  cachePath: "/tmp/none",
  ttlMs: 0,
  offline: true,
  noCache: true,
};

describe("runDoctor: modelResolution section", () => {
  test("reports installed agents and exit code 1 when stale model present", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-doctor-models-"));
    const oc = join(tmp, "oc");
    await mkdir(oc, { recursive: true });
    await writeFile(
      join(oc, "stale.md"),
      "---\nmodel: anthropic/dead-1-0\n---\nbody",
    );
    await writeFile(
      join(oc, "fresh.md"),
      "---\nmodel: github-copilot/claude-opus-4.7\n---\nbody",
    );

    const r = await runDoctor({
      vendoredSchema: {},
      schemaMeta: stubSchemaMeta,
      claudeMeta: stubToolMapMeta,
      codexMeta: stubToolMapMeta,
      deps: stubDeps,
      modelResolution: {
        getOpenCodeModels: async () => ["github-copilot/claude-opus-4.7"],
        findOpencodeOnPath: async () => "/fake/opencode",
        installedPaths: {
          opencodeAgentsDir: oc,
          claudeCodeAgentsDir: join(tmp, "absent-cc"),
          codexAgentsDir: join(tmp, "absent-cd"),
        },
        curatedFallback: {
          high: "github-copilot/claude-opus-4.7",
          balanced: "github-copilot/claude-sonnet-4.6",
          fast: "github-copilot/claude-haiku-4.5",
        },
      },
    });

    expect(r.modelResolution).toBeDefined();
    expect(r.modelResolution?.installedAgents).toHaveLength(2);
    expect(r.modelResolution?.hasStale).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  test("exit code 1 when curated fallback not in live list", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-doctor-fallback-"));
    const r = await runDoctor({
      vendoredSchema: {},
      schemaMeta: stubSchemaMeta,
      claudeMeta: stubToolMapMeta,
      codexMeta: stubToolMapMeta,
      deps: stubDeps,
      modelResolution: {
        getOpenCodeModels: async () => ["github-copilot/some-other-model"],
        findOpencodeOnPath: async () => "/fake/opencode",
        installedPaths: {
          opencodeAgentsDir: join(tmp, "absent-oc"),
          claudeCodeAgentsDir: join(tmp, "absent-cc"),
          codexAgentsDir: join(tmp, "absent-cd"),
        },
        curatedFallback: {
          high: "github-copilot/claude-opus-4.7",
          balanced: "github-copilot/claude-sonnet-4.6",
          fast: "github-copilot/claude-haiku-4.5",
        },
      },
    });
    expect(r.exitCode).toBe(0);
    expect(
      r.modelResolution?.curatedFallbacks.every((f) => f.inLiveList === false),
    ).toBe(true);
  });

  test("exit code 0 when all green and modelResolution config provided", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-doctor-green-"));
    const oc = join(tmp, "oc");
    await mkdir(oc, { recursive: true });
    await writeFile(
      join(oc, "fresh.md"),
      "---\nmodel: github-copilot/claude-opus-4.7\n---\nbody",
    );
    const live = [
      "github-copilot/claude-opus-4.7",
      "github-copilot/claude-sonnet-4.6",
      "github-copilot/claude-haiku-4.5",
    ];
    const r = await runDoctor({
      vendoredSchema: {},
      schemaMeta: stubSchemaMeta,
      claudeMeta: stubToolMapMeta,
      codexMeta: stubToolMapMeta,
      deps: stubDeps,
      modelResolution: {
        getOpenCodeModels: async () => live,
        findOpencodeOnPath: async () => "/fake/opencode",
        installedPaths: {
          opencodeAgentsDir: oc,
          claudeCodeAgentsDir: join(tmp, "absent"),
          codexAgentsDir: join(tmp, "absent"),
        },
        curatedFallback: {
          high: live[0]!,
          balanced: live[1]!,
          fast: live[2]!,
        },
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.modelResolution?.hasStale).toBe(false);
  });

  test("modelResolution omitted -> no section in report", async () => {
    const r = await runDoctor({
      vendoredSchema: {},
      schemaMeta: stubSchemaMeta,
      claudeMeta: stubToolMapMeta,
      codexMeta: stubToolMapMeta,
      deps: stubDeps,
    });
    expect(r.modelResolution).toBeUndefined();
  });
});
