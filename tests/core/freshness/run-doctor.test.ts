import { describe, expect, test } from "bun:test";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import type {
  DoctorSectionDoneEvent,
  DoctorSectionStartEvent,
} from "../../../src/core/freshness/run-doctor";
import { modelResolutionEventStatus, runDoctor } from "../../../src/core/freshness/run-doctor";
import type {
  DoctorDeps,
  ModelResolutionReport,
  SchemaCache,
  SchemaMeta,
  ToolMapMeta,
} from "../../../src/core/freshness/types";
import type { PlatformAuthMatrix } from "../../../src/io/auth/types";
import type { WorkspaceVersionStatus } from "../../../src/io/workspace-version";

const authedMatrix: PlatformAuthMatrix = {
  opencode: { platform: "opencode", cliInstalled: true, status: "authenticated" },
  "claude-code": { platform: "claude-code", cliInstalled: true, status: "authenticated" },
  codex: { platform: "codex", cliInstalled: true, status: "authenticated" },
  kiro: { platform: "kiro", cliInstalled: true, status: "authenticated" },
};

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools",
  notes: "",
};

const codexMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "https://github.com/openai/codex",
  notes: "",
};

const schemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "https://opencode.ai/config.json",
  schemaId: null,
  version: null,
  notes: "",
};

const vendoredSchema = { properties: { agent: { type: "object" } } };

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  const cacheIO = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-02T00:00:00.000Z"),
    readCache: cacheIO.readCache,
    writeCache: cacheIO.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
    ...over,
  };
}

describe("runDoctor", () => {
  test("no-drift case → exit 0, all three platforms reported", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(report.exitCode).toBe(0);
    expect(report.platforms).toHaveLength(3);
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("fresh");
  });

  test("default (no installedPlatforms input) → all platforms reported, skippedPlatforms=[]", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(report.platforms).toHaveLength(3);
    expect(report.skippedPlatforms).toEqual([]);
  });

  test("only codex installed → platforms contains only codex; skippedPlatforms lists the rest; modelResolution absent", async () => {
    const events: Array<{ id: string; phase: "start" | "done" }> = [];
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["codex"]),
      // intentionally provide modelResolution; should be dropped because opencode skipped
      modelResolution: {
        getOpenCodeModels: async () => ["claude-opus-4"],
        findOpencodeOnPath: async () => null,
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "claude-opus-4",
          balanced: "claude-sonnet-4",
          fast: "claude-haiku-4",
        },
      },
      onSectionStart: (e) => events.push({ id: e.id, phase: "start" }),
      onSectionDone: (e) => events.push({ id: e.id, phase: "done" }),
    });
    expect(report.platforms.map((p) => p.platform)).toEqual(["codex"]);
    expect(report.skippedPlatforms).toEqual(["claude-code", "kiro", "opencode"]);
    expect(report.modelResolution).toBeUndefined();
    expect(report.exitCode).toBe(0); // opencode skipped → no drift/network-error branch
    // No opencode/claude-code/model-resolution events emitted
    const emittedIds = new Set(events.map((e) => e.id));
    expect(emittedIds.has("opencode")).toBe(false);
    expect(emittedIds.has("claude-code")).toBe(false);
    expect(emittedIds.has("model-resolution")).toBe(false);
    expect(emittedIds.has("codex")).toBe(true);
  });

  test("only opencode installed + drift → platforms contains only opencode; exit 1; modelResolution present", async () => {
    const live = { properties: { agent: { type: "object", new: 1 } } };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => new Response(JSON.stringify(live), { status: 200 }),
      }),
      installedPlatforms: new Set(["opencode"]),
      modelResolution: {
        getOpenCodeModels: async () => ["claude-opus-4"],
        findOpencodeOnPath: async () => "/usr/bin/opencode",
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "claude-opus-4",
          balanced: "claude-sonnet-4",
          fast: "claude-haiku-4",
        },
      },
    });
    expect(report.platforms.map((p) => p.platform)).toEqual(["opencode"]);
    expect(report.skippedPlatforms).toEqual(["claude-code", "codex", "kiro"]);
    expect(report.modelResolution).toBeDefined();
    expect(report.exitCode).toBe(1);
  });

  test("two platforms installed (claude-code + codex) → both present, opencode skipped, no modelResolution", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["claude-code", "codex"]),
    });
    expect(report.platforms.map((p) => p.platform).sort()).toEqual(["claude-code", "codex"]);
    expect(report.skippedPlatforms).toEqual(["kiro", "opencode"]);
    expect(report.modelResolution).toBeUndefined();
  });

  test("empty installedPlatforms set → no platform sections, but cross-cutting sections still run", async () => {
    // Note: the CLI wrapper refuses before invoking runDoctor in production
    // when no platforms are detected. This test exercises the orchestrator
    // contract directly for completeness.
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(),
    });
    expect(report.platforms).toEqual([]);
    expect(report.skippedPlatforms).toEqual(["claude-code", "codex", "kiro", "opencode"]);
    expect(report.exitCode).toBe(0);
  });

  test("drift case → exit 1, drift summary populated", async () => {
    const live = { properties: { agent: { type: "object", new: 1 } } };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => new Response(JSON.stringify(live), { status: 200 }),
      }),
    });
    expect(report.exitCode).toBe(1);
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("drift");
    if (oc?.status === "drift") {
      expect(
        oc.drift.added.length + oc.drift.removed.length + oc.drift.changed.length,
      ).toBeGreaterThan(0);
    }
  });

  test("network failure (no cache) → exit 2, status network-error", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    });
    expect(report.exitCode).toBe(2);
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("network-error");
  });

  test("redacts query-secret values in networkError on fetch failure", async () => {
    const secretMeta: SchemaMeta = {
      ...schemaMeta,
      sourceUrl: "https://schema.example.com/v1?token=xxx",
    };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta: secretMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => {
          throw new TypeError(
            "fetch failed: getaddrinfo ENOTFOUND for https://schema.example.com/v1?token=xxx",
          );
        },
      }),
    });
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("network-error");
    if (oc?.status !== "network-error") throw new Error("narrow");
    expect(oc.networkError).toContain("[redacted]");
    expect(oc.networkError).not.toContain("xxx");
  });

  test("HTTP non-2xx → exit 2, status network-error", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => new Response("nope", { status: 503 }),
      }),
    });
    expect(report.exitCode).toBe(2);
  });

  test("--offline skips fetch → exit 0, status offline-skipped", async () => {
    let called = false;
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        offline: true,
        fetch: async () => {
          called = true;
          return new Response("{}");
        },
      }),
    });
    expect(called).toBe(false);
    expect(report.exitCode).toBe(0);
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("offline-skipped");
  });

  test("cache hit within TTL → no fetch", async () => {
    const cacheIO = makeMemoryCacheIO();
    const cached: SchemaCache = {
      fetchedAt: "2026-05-01T18:00:00.000Z", // 6h before now
      schema: vendoredSchema,
    };
    await cacheIO.writeCache("/tmp/cache.json", cached);
    let called = false;
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        readCache: cacheIO.readCache,
        writeCache: cacheIO.writeCache,
        fetch: async () => {
          called = true;
          return new Response("{}");
        },
      }),
    });
    expect(called).toBe(false);
  });

  test("stale cache (older than TTL) → fetch is called", async () => {
    const cacheIO = makeMemoryCacheIO();
    // Cache fetched 48h before now (well outside the 24h TTL).
    await cacheIO.writeCache("/tmp/cache.json", {
      fetchedAt: "2026-04-30T00:00:00.000Z",
      schema: vendoredSchema,
    });
    let called = false;
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        readCache: cacheIO.readCache,
        writeCache: cacheIO.writeCache,
        fetch: async () => {
          called = true;
          return new Response(JSON.stringify(vendoredSchema));
        },
      }),
    });
    expect(called).toBe(true);
  });

  test("stale cache + fetch failure → network-error (does not silently use stale cache)", async () => {
    const cacheIO = makeMemoryCacheIO();
    await cacheIO.writeCache("/tmp/cache.json", {
      fetchedAt: "2026-04-30T00:00:00.000Z", // stale
      schema: vendoredSchema,
    });
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        readCache: cacheIO.readCache,
        writeCache: cacheIO.writeCache,
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    });
    expect(report.exitCode).toBe(2);
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.status).toBe("network-error");
  });

  test("noCache: true forces fetch even if cache fresh", async () => {
    const cacheIO = makeMemoryCacheIO();
    await cacheIO.writeCache("/tmp/cache.json", {
      fetchedAt: "2026-05-01T23:59:00.000Z",
      schema: vendoredSchema,
    });
    let called = false;
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        readCache: cacheIO.readCache,
        writeCache: cacheIO.writeCache,
        noCache: true,
        fetch: async () => {
          called = true;
          return new Response(JSON.stringify(vendoredSchema));
        },
      }),
    });
    expect(called).toBe(true);
  });

  test("successful fetch writes the cache", async () => {
    const cacheIO = makeMemoryCacheIO();
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        readCache: cacheIO.readCache,
        writeCache: cacheIO.writeCache,
      }),
    });
    expect(await cacheIO.readCache("/tmp/cache.json")).not.toBeNull();
  });

  test("liveSchemaId and liveVersion are extracted from the live schema's $id and version", async () => {
    const live = {
      $id: "https://opencode.ai/schema.json",
      version: "1.14.28",
      properties: { agent: { type: "object" } },
    };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => new Response(JSON.stringify(live), { status: 200 }),
      }),
    });
    const oc = report.platforms.find((p) => p.platform === "opencode");
    expect(oc?.platform).toBe("opencode");
    if (oc?.platform === "opencode") {
      expect(oc.liveSchemaId).toBe("https://opencode.ai/schema.json");
      expect(oc.liveVersion).toBe("1.14.28");
    }
  });
});

describe("runDoctor streaming callbacks", () => {
  test("fires onSectionStart and onSectionDone for opencode in correct order with ok status when fresh", async () => {
    const events: Array<["start" | "done", string, string?]> = [];
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      onSectionStart: (e: DoctorSectionStartEvent) => events.push(["start", e.id]),
      onSectionDone: (e: DoctorSectionDoneEvent) =>
        events.push(["done", e.id, `${e.status}:${e.summary}`]),
    });
    // First two events must be opencode start then done with ok status.
    expect(events[0]).toEqual(["start", "opencode"]);
    expect(events[1]?.[0]).toBe("done");
    expect(events[1]?.[1]).toBe("opencode");
    expect(events[1]?.[2]).toMatch(/^ok:OpenCode schema fresh$/);
    // Subsequent claude-code/codex sections also fire (manual).
    const ids = events.filter((e) => e[0] === "done").map((e) => e[1]);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
  });

  test("fires opencode done event with warn status and drift count when drift detected", async () => {
    const live = { properties: { agent: { type: "object", new: 1 } } };
    const events: DoctorSectionDoneEvent[] = [];
    await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({
        fetch: async () => new Response(JSON.stringify(live), { status: 200 }),
      }),
      onSectionDone: (e) => events.push(e),
    });
    const oc = events.find((e) => e.id === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.status).toBe("warn");
    expect(oc?.summary).toMatch(/^OpenCode schema drift detected \(\d+ changes?\)$/);
  });

  test("fires workspace done event with diverged summary when checkWorkspaceVersion returns diverged", async () => {
    const events: DoctorSectionDoneEvent[] = [];
    const fakeStatus: WorkspaceVersionStatus = {
      status: "diverged",
      commitsBehind: 2,
      commitsAhead: 3,
    };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps({ offline: true }),
      onSectionDone: (e) => events.push(e),
      workspace: {
        importMetaUrl: import.meta.url,
        offline: false,
        resolve: async () => "/fake/workspace",
        check: async () => fakeStatus,
      },
    });
    const ws = events.find((e) => e.id === "workspace");
    expect(ws).toBeDefined();
    expect(ws?.status).toBe("warn");
    expect(ws?.summary).toBe("Workspace diverged: 2 behind, 3 ahead");
    // Workspace must also appear on the report and not affect exit code.
    expect(report.workspace).toEqual(fakeStatus);
    expect(report.exitCode).toBe(0);
  });

  test("does not fire any callbacks when callbacks are omitted (back-compat)", async () => {
    // No-op test: just ensure the call succeeds without callbacks and
    // produces the same shape as before.
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(report.platforms).toHaveLength(3);
    expect(report.workspace).toBeUndefined();
  });
});

describe("runDoctor: atlassianAuth section", () => {
  test("emits start and done events for atlassian-auth when configured", async () => {
    const events: Array<{ kind: "start" | "done"; id: string; status?: string }> = [];
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      resolveAtlassianAuth: () => ({
        email: "alice@x",
        token: "tok-A",
        source: "file-smith",
      }),
      resolveAtlassianBaseUrl: () => "https://acme.atlassian.net",
      onSectionStart: (e) => events.push({ kind: "start", id: e.id }),
      onSectionDone: (e) => events.push({ kind: "done", id: e.id, status: e.status }),
    });

    const authEvents = events.filter((e) => e.id === "atlassian-auth");
    expect(authEvents).toHaveLength(2);
    expect(authEvents[0]?.kind).toBe("start");
    expect(authEvents[1]?.kind).toBe("done");
    expect(authEvents[1]?.status).toBe("ok");

    expect(result.atlassianAuth).toEqual({
      status: "configured",
      source: "file-smith",
      baseUrl: "https://acme.atlassian.net",
    });
  });

  test("emits 'warn' status with 'incomplete' report when auth resolves but baseUrl missing", async () => {
    // rc.4: auth-without-baseUrl is its own state. The doctor must
    // surface this distinctly from "missing" so users with email+token
    // configured get told the actionable thing (set the workspace URL)
    // rather than "configure credentials" (which is misleading — they
    // already have credentials).
    const events: Array<{ kind: "start" | "done"; id: string; status?: string }> = [];
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      hasAtlassianKnowledgeSources: true,
      resolveAtlassianAuth: () => ({
        email: "alice@x",
        token: "tok-A",
        source: "file-smith",
      }),
      resolveAtlassianBaseUrl: () => null,
      onSectionStart: (e) => events.push({ kind: "start", id: e.id }),
      onSectionDone: (e) => events.push({ kind: "done", id: e.id, status: e.status }),
    });

    const authEvents = events.filter((e) => e.id === "atlassian-auth");
    expect(authEvents[1]?.status).toBe("warn");
    expect(result.atlassianAuth).toEqual({
      status: "incomplete",
      source: "file-smith",
      reason: "missing-base-url",
    });
  });

  test("emits 'warn' status when no creds resolve", async () => {
    const events: Array<{ kind: "start" | "done"; id: string; status?: string }> = [];
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      hasAtlassianKnowledgeSources: true,
      resolveAtlassianAuth: () => null,
      onSectionDone: (e) => events.push({ kind: "done", id: e.id, status: e.status }),
    });
    expect(result.atlassianAuth).toEqual({ status: "missing" });
    const done = events.find((e) => e.id === "atlassian-auth");
    expect(done?.status).toBe("warn");
  });

  test("includes atlassianSkills sub-status when atlassian-skills is installed + bridge in-sync + Python OK", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      resolveAtlassianAuth: () => ({ email: "a@x", token: "t", source: "file-smith" }),
      resolveAtlassianBaseUrl: () => "https://acme.atlassian.net",
      loadInstalledSkillsForAuth: async () => ({
        schemaVersion: 1,
        installed: [
          {
            name: "atlassian-readonly-skills",
            sourceCatalogLabel: "atlassian-skills",
            sourcePath: "/s",
            installedPaths: {},
            contentHash: "h",
            installedAt: "2026-01-01",
          },
        ],
      }),
      readEnvForBridge: async () => ({
        SMITH_ATLASSIAN_EMAIL: "a@x",
        SMITH_ATLASSIAN_API_TOKEN: "t",
        SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
        JIRA_URL: "https://acme.atlassian.net",
        JIRA_USERNAME: "a@x",
        JIRA_API_TOKEN: "t",
        CONFLUENCE_URL: "https://acme.atlassian.net/wiki",
        CONFLUENCE_USERNAME: "a@x",
        CONFLUENCE_API_TOKEN: "t",
      }),
      detectPython: async () => ({
        binary: "python3",
        version: "3.11.4",
        versionOk: true,
        packagesAvailable: { requests: true, dotenv: true },
      }),
    });
    const auth = result.atlassianAuth;
    expect(auth?.status).toBe("configured");
    if (auth?.status === "configured") {
      expect(auth.atlassianSkills).toBeDefined();
      expect(auth.atlassianSkills?.bridgeStatus).toBe("in-sync");
      expect(auth.atlassianSkills?.python.binary).toBe("python3");
      expect(auth.atlassianSkills?.python.versionOk).toBe(true);
    }
  });

  test("includes atlassianSkills with bridge drift when env vars mismatch", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      resolveAtlassianAuth: () => ({ email: "a@x", token: "t", source: "env-smith" }),
      resolveAtlassianBaseUrl: () => "https://acme.atlassian.net",
      loadInstalledSkillsForAuth: async () => ({
        schemaVersion: 1,
        installed: [
          {
            name: "atlassian-readonly-skills",
            sourceCatalogLabel: "atlassian-skills",
            sourcePath: "/s",
            installedPaths: {},
            contentHash: "h",
            installedAt: "2026-01-01",
          },
        ],
      }),
      readEnvForBridge: async () => ({
        SMITH_ATLASSIAN_EMAIL: "a@x",
        SMITH_ATLASSIAN_API_TOKEN: "t",
        SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
        JIRA_URL: "https://old.atlassian.net",
        JIRA_USERNAME: "a@x",
        JIRA_API_TOKEN: "t",
        CONFLUENCE_URL: "https://acme.atlassian.net/wiki",
        CONFLUENCE_USERNAME: "a@x",
        CONFLUENCE_API_TOKEN: "t",
      }),
      detectPython: async () => ({
        binary: "python3",
        version: "3.11.4",
        versionOk: true,
        packagesAvailable: { requests: true, dotenv: true },
      }),
    });
    const auth = result.atlassianAuth;
    if (auth?.status === "configured") {
      expect(auth.atlassianSkills?.bridgeStatus).toBe("drift");
      expect(auth.atlassianSkills?.bridgeReasons).toBeDefined();
    }
  });

  test("includes atlassianSkills with python missing when no binary found", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      resolveAtlassianAuth: () => ({ email: "a@x", token: "t", source: "file-smith" }),
      resolveAtlassianBaseUrl: () => "https://acme.atlassian.net",
      loadInstalledSkillsForAuth: async () => ({
        schemaVersion: 1,
        installed: [
          {
            name: "atlassian-readonly-skills",
            sourceCatalogLabel: "atlassian-skills",
            sourcePath: "/s",
            installedPaths: {},
            contentHash: "h",
            installedAt: "2026-01-01",
          },
        ],
      }),
      readEnvForBridge: async () => ({
        SMITH_ATLASSIAN_EMAIL: "a@x",
        SMITH_ATLASSIAN_API_TOKEN: "t",
        SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
        JIRA_URL: "https://acme.atlassian.net",
        JIRA_USERNAME: "a@x",
        JIRA_API_TOKEN: "t",
        CONFLUENCE_URL: "https://acme.atlassian.net/wiki",
        CONFLUENCE_USERNAME: "a@x",
        CONFLUENCE_API_TOKEN: "t",
      }),
      detectPython: async () => ({
        binary: null,
        version: null,
        versionOk: false,
        packagesAvailable: { requests: false, dotenv: false },
      }),
    });
    const auth = result.atlassianAuth;
    if (auth?.status === "configured") {
      expect(auth.atlassianSkills?.python.binary).toBeNull();
      expect(auth.atlassianSkills?.python.versionOk).toBe(false);
    }
  });

  test("no atlassianSkills field when atlassian-skills NOT installed", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      resolveAtlassianAuth: () => ({ email: "a@x", token: "t", source: "file-smith" }),
      resolveAtlassianBaseUrl: () => "https://acme.atlassian.net",
      loadInstalledSkillsForAuth: async () => ({ schemaVersion: 1, installed: [] }),
      readEnvForBridge: async () => ({}),
    });
    const auth = result.atlassianAuth;
    if (auth?.status === "configured") {
      expect(auth.atlassianSkills).toBeUndefined();
    }
  });
});

describe("runDoctor: agent-required-skills section", () => {
  test("reports OK when all required skills installed; emits start+done events", async () => {
    const events: Array<{ kind: "start" | "done"; id: string; status?: string }> = [];
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      loadAgentsForDoctor: async () => [
        {
          name: "team-helper",
          requires: { skills: [{ name: "jira-helper" }, { name: "confluence-helper" }] },
        },
      ],
      loadInstalledSkillNames: async () => ["jira-helper", "confluence-helper"],
      onSectionStart: (e) => events.push({ kind: "start", id: e.id }),
      onSectionDone: (e) => events.push({ kind: "done", id: e.id, status: e.status }),
    });

    const sec = events.filter((e) => e.id === "agent-required-skills");
    expect(sec).toHaveLength(2);
    expect(sec[1]?.status).toBe("ok");
    expect(result.agentRequiredSkills).toEqual({ status: "ok", agents: [] });
  });

  test("warns when at least one agent has a missing required skill", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      loadAgentsForDoctor: async () => [
        {
          name: "team-helper",
          requires: { skills: [{ catalog: "team", name: "jira-helper" }] },
        },
        { name: "plain-agent" },
      ],
      loadInstalledSkillNames: async () => [],
    });

    expect(result.agentRequiredSkills?.status).toBe("warn");
    expect(result.agentRequiredSkills?.agents).toEqual([
      { name: "team-helper", missing: [{ catalog: "team", name: "jira-helper" }] },
    ]);
  });

  test("section absent when loadAgentsForDoctor not provided", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(result.agentRequiredSkills).toBeUndefined();
  });

  test("no agents have requires.skills → status ok, agents=[]", async () => {
    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      loadAgentsForDoctor: async () => [{ name: "plain-agent" }],
      loadInstalledSkillNames: async () => [],
    });
    expect(result.agentRequiredSkills).toEqual({ status: "ok", agents: [] });
  });

  test("knowledgeConsistency section: ok when input provided and no drift", async () => {
    const events: DoctorSectionDoneEvent[] = [];
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      onSectionDone: (e) => events.push(e),
      knowledgeConsistency: {
        agentSmithHome: "/nonexistent",
        installPaths: {
          opencode: "/nonexistent",
          "claude-code": "/nonexistent",
          codex: "/nonexistent",
          kiro: "/nonexistent",
        },
        agents: [],
      },
    });
    expect(report.knowledgeConsistency).toBeDefined();
    expect(report.knowledgeConsistency!.status).toBe("skipped");
    const ev = events.find((e) => e.id === "knowledge-prompt-disk-consistency");
    expect(ev).toBeDefined();
    expect(ev!.status).toBe("skipped");
  });

  test("knowledgeConsistency section: drift when agents have missing files", async () => {
    // Use a temp dir with a prompt that has bullets but no knowledge files
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "smith-doctor-kc-e2e-"));
    try {
      const opencodeDir = join(root, "opencode");
      await mkdir(opencodeDir, { recursive: true });
      await writeFile(
        join(opencodeDir, "myagent.md"),
        "## Knowledge Index\n\n- sources/wiki/page1.md\n- sources/wiki/page2.md\n",
      );
      const events: DoctorSectionDoneEvent[] = [];
      const report = await runDoctor({
        vendoredSchema,
        schemaMeta,
        claudeMeta,
        codexMeta,
        deps: deps(),
        onSectionDone: (e) => events.push(e),
        knowledgeConsistency: {
          agentSmithHome: join(root, "agent-smith-home"),
          installPaths: {
            opencode: opencodeDir,
            "claude-code": "/nonexistent",
            codex: "/nonexistent",
            kiro: "/nonexistent",
          },
          agents: ["myagent"],
        },
      });
      expect(report.knowledgeConsistency).toBeDefined();
      expect(report.knowledgeConsistency!.status).toBe("drift");
      const ev = events.find((e) => e.id === "knowledge-prompt-disk-consistency");
      expect(ev!.status).toBe("warn");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function mr(over: Partial<ModelResolutionReport> = {}): ModelResolutionReport {
  return {
    opencodeCliPath: "/fake/opencode",
    liveModelCount: 0,
    curatedFallbacks: [
      { tier: "high", value: "p/opus", inLiveList: false },
      { tier: "balanced", value: "p/sonnet", inLiveList: false },
      { tier: "fast", value: "p/haiku", inLiveList: false },
    ],
    installedAgents: [],
    hasStale: false,
    detectedProviders: [],
    preferenceOrder: [],
    platforms: {
      opencode: { cliInstalled: true, status: "authenticated" },
      "claude-code": { cliInstalled: true, status: "authenticated" },
      codex: { cliInstalled: true, status: "authenticated" },
      kiro: { cliInstalled: true, status: "authenticated" },
    },
    tierPreview: [],
    ...over,
  };
}

describe("modelResolutionEventStatus (actionable-only)", () => {
  test("curated-fallback drift alone (no installed agents) → ok", () => {
    expect(modelResolutionEventStatus(mr())).toBe("ok");
  });

  test("fallback drift WITH an installed opencode agent → still ok (drift is not actionable)", () => {
    const r = mr({
      installedAgents: [
        { platform: "opencode", agent: "a", model: "p/opus", inLiveList: true },
      ],
    });
    expect(modelResolutionEventStatus(r)).toBe("ok");
  });

  test("stale installed opencode agent → warn", () => {
    const r = mr({
      installedAgents: [
        { platform: "opencode", agent: "a", model: "p/x", inLiveList: false },
      ],
      hasStale: true,
    });
    expect(modelResolutionEventStatus(r)).toBe("warn");
  });

  test("installed agent on an unauthenticated platform → warn", () => {
    const r = mr({
      installedAgents: [
        { platform: "codex", agent: "a", model: "gpt-5", inLiveList: null },
      ],
      platforms: {
        opencode: { cliInstalled: true, status: "authenticated" },
        "claude-code": { cliInstalled: true, status: "authenticated" },
        codex: { cliInstalled: true, status: "unauthenticated" },
        kiro: { cliInstalled: true, status: "authenticated" },
      },
    });
    expect(modelResolutionEventStatus(r)).toBe("warn");
  });
});

describe("runDoctor exit code (fallback drift no longer bumps)", () => {
  test("curated-fallback drift only → exit 0", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      modelResolution: {
        getOpenCodeModels: async () => [],
        findOpencodeOnPath: async () => "/fake/opencode",
        installedPaths: {
          opencodeAgentsDir: "/nonexistent-x",
          claudeCodeAgentsDir: "/nonexistent-y",
          codexAgentsDir: "/nonexistent-z",
        },
        curatedFallback: { high: "p/opus", balanced: "p/sonnet", fast: "p/haiku" },
        platformAuth: authedMatrix,
        detectAuthenticatedProviders: async () => ["opencode"],
        readEnvFile: () => ({}),
      },
    });
    expect(report.modelResolution?.curatedFallbacks.every((f) => f.inLiveList === false)).toBe(true);
    expect(report.exitCode).toBe(0);
  });
});

import type { InstalledSkillsFile } from "../../../src/io/installed-skills";

const emptySkills = { schemaVersion: 1, installed: [] } as unknown as InstalledSkillsFile;

async function atlStatus(over: {
  hasAtlassianKnowledgeSources?: boolean;
}): Promise<string | undefined> {
  const events: DoctorSectionDoneEvent[] = [];
  await runDoctor({
    vendoredSchema,
    schemaMeta,
    claudeMeta,
    codexMeta,
    deps: deps(),
    resolveAtlassianAuth: () => null,
    resolveAtlassianBaseUrl: () => null,
    loadInstalledSkillsForAuth: async () => emptySkills,
    ...over,
    onSectionDone: (e) => events.push(e),
  });
  return events.find((e) => e.id === "atlassian-auth")?.status;
}

describe("Atlassian relevance gating", () => {
  test("auth missing + no skills + no confluence/jira sources → skipped", async () => {
    expect(await atlStatus({ hasAtlassianKnowledgeSources: false })).toBe("skipped");
  });

  test("auth missing + an agent has a confluence/jira source → warn", async () => {
    expect(await atlStatus({ hasAtlassianKnowledgeSources: true })).toBe("warn");
  });
});

import { agentDriftEventStatus } from "../../../src/core/freshness/run-doctor";
import type { AgentDriftReport } from "../../../src/core/freshness/types";

describe("agentDriftEventStatus", () => {
  const ok: AgentDriftReport = {
    entries: [{ name: "a", platform: "claude-code", status: "ok", path: "/p" }],
  };
  const drift: AgentDriftReport = {
    entries: [
      { name: "a", platform: "claude-code", status: "ok", path: "/p" },
      { name: "b", platform: "codex", status: "drift", path: "/q", recordedHash: "sha256:1", currentHash: "sha256:2" },
    ],
  };
  test("all ok → ok", () => expect(agentDriftEventStatus(ok)).toBe("ok"));
  test("empty → ok", () => expect(agentDriftEventStatus({ entries: [] })).toBe("ok"));
  test("any drift/missing → warn", () => expect(agentDriftEventStatus(drift)).toBe("warn"));
});

describe("checkAgentDrift via runDoctor", () => {
  test("ok + drift + missing classified; section warn but exit code unaffected", async () => {
    const events: DoctorSectionDoneEvent[] = [];
    const installed = {
      schemaVersion: 1 as const,
      installed: [
        { name: "ok-agent", platform: "claude-code", path: "/x/ok", contentHash: "sha256:OK", installedAt: "t" },
        { name: "drift-agent", platform: "codex", path: "/x/drift", contentHash: "sha256:OLD", installedAt: "t" },
        { name: "gone-agent", platform: "kiro", path: "/x/gone", contentHash: "sha256:G", installedAt: "t" },
      ],
    };
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      agentDrift: {
        loadInstalled: async () => installed,
        pathExists: async (p: string) => p !== "/x/gone",
        hashFile: async (p: string) => (p === "/x/drift" ? "sha256:NEW" : "sha256:OK"),
      },
      onSectionDone: (e) => events.push(e),
    });
    expect(report.agentDrift?.entries.map((e) => e.status)).toEqual(["ok", "drift", "missing"]);
    expect(events.find((e) => e.id === "agent-drift")?.status).toBe("warn");
    expect(report.exitCode).toBe(0);
  });
});
