import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager, type Spawner } from "../jobs/job-manager";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "read-routes-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("doctor route", () => {
  it("returns the real-shape doctor report when CLI emits it", async () => {
    const realReport = {
      generatedAt: "2026-05-20T10:00:00.000Z",
      platforms: [
        {
          platform: "opencode",
          status: "fresh",
          vendoredDate: "2026-05-19",
          sourceUrl: "https://example",
          liveSchemaId: "x",
          liveVersion: "1.0",
        },
      ],
      skippedPlatforms: ["claude-code", "codex"],
      atlassianAuth: { status: "missing" },
      exitCode: 0,
    };
    const spawner: Spawner = (_argv, h) => {
      h.onStdout(JSON.stringify(realReport));
      h.onExit(0);
      return { stop: () => {}, writeStdin: () => {} };
    };
    const app = createApp({ token: "t", jobs: new JobManager({ spawner }) });
    const res = await app.request("/api/doctor", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exitCode: number;
      platforms: { platform: string }[];
    };
    expect(body.exitCode).toBe(0);
    expect(body.platforms[0].platform).toBe("opencode");
  });

  it("returns the refusal payload when CLI emits no-platform-detected", async () => {
    const refusal = {
      error: "no-platform-detected",
      message: "No supported AI coding platform detected on PATH.",
      exitCode: 2,
    };
    const spawner: Spawner = (_argv, h) => {
      h.onStdout(JSON.stringify(refusal));
      h.onExit(2);
      return { stop: () => {}, writeStdin: () => {} };
    };
    const app = createApp({ token: "t", jobs: new JobManager({ spawner }) });
    const res = await app.request("/api/doctor", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string; exitCode: number };
    expect(body.error).toBe("no-platform-detected");
    expect(body.exitCode).toBe(2);
  });

  it("returns DOCTOR_PARSE when smith doctor emits invalid JSON", async () => {
    const garbageSpawner: Spawner = (_argv, h) => {
      h.onStdout("not valid json {{{");
      h.onExit(0);
      return { stop: () => {}, writeStdin: () => {} };
    };
    const jm = new JobManager({ spawner: garbageSpawner });
    const app = createApp({ token: "t", jobs: jm });
    const res = await app.request("/api/doctor", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("DOCTOR_PARSE");
  });
});

describe("status route", () => {
  it("returns agentCount based on registry (no daemon fields)", async () => {
    // rc.3: /api/status no longer reports daemonRunning. The TopBar
    // and StatStrip now consume /api/daemon/status directly so the
    // four-state daemon classification is the single source of truth.
    const registry = join(root, "registry.json");
    await writeFile(registry, JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({ token: "t", jobs: jm, registryPath: registry });
    const res = await app.request("/api/status", { headers: { authorization: "Bearer t" } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.agentCount).toBe(0);
    // Daemon fields removed in rc.3.
    expect(body.daemonRunning).toBeUndefined();
  });

  it("agentCount sums agents across all catalogs in the registry", async () => {
    const registry = join(root, "registry.json");
    await writeFile(
      registry,
      JSON.stringify({
        catalogs: {
          "cat-a": { path: "/p/a", agents: ["one", "two"] },
          "cat-b": { path: "/p/b", agents: ["three"] },
        },
      }),
    );
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({ token: "t", jobs: jm, registryPath: registry });
    const res = await app.request("/api/status", { headers: { authorization: "Bearer t" } });
    const body = (await res.json()) as { agentCount: number };
    expect(body.agentCount).toBe(3);
  });
});

describe("onboarding route", () => {
  it("returns FIRST_RUN when ~/.config/agent-smith does not exist", async () => {
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: join(root, "absent"),
      registryPath: join(root, "absent", "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("FIRST_RUN");
  });

  it("returns ZERO_AGENTS when config + USER.md exist but no agents", async () => {
    const config = join(root, "agent-smith");
    await mkdir(config, { recursive: true });
    await writeFile(join(config, "USER.md"), "I am someone with substantial content here.");
    await writeFile(join(config, "registry.json"), JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: config,
      registryPath: join(config, "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("ZERO_AGENTS");
  });

  it("returns NEEDS_USER_MD when configRoot exists but USER.md is missing", async () => {
    const config = join(root, "agent-smith");
    await mkdir(config, { recursive: true });
    await writeFile(join(config, "registry.json"), JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: config,
      registryPath: join(config, "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("NEEDS_USER_MD");
  });

  it("returns NEEDS_USER_MD when USER.md trims to fewer than MIN_USER_MD_LEN (40) chars", async () => {
    const config = join(root, "agent-smith");
    await mkdir(config, { recursive: true });
    // Pad with whitespace to verify we compare the *trimmed* length, not raw.
    const stub = `   ${"a".repeat(39)}   `;
    await writeFile(join(config, "USER.md"), stub);
    await writeFile(join(config, "registry.json"), JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: config,
      registryPath: join(config, "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("NEEDS_USER_MD");
  });

  it("treats USER.md exactly at MIN_USER_MD_LEN (40 chars trimmed) as sufficient", async () => {
    // Boundary check: MIN_USER_MD_LEN=40 and the comparison is `>= 40`, so 40
    // chars (after trim) must pass past NEEDS_USER_MD. With an empty registry
    // we then expect ZERO_AGENTS.
    const config = join(root, "agent-smith");
    await mkdir(config, { recursive: true });
    await writeFile(join(config, "USER.md"), "a".repeat(40));
    await writeFile(join(config, "registry.json"), JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: config,
      registryPath: join(config, "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("ZERO_AGENTS");
  });

  it("returns HOME with agentCount>0 when registry has agents", async () => {
    const config = join(root, "agent-smith");
    await mkdir(config, { recursive: true });
    await writeFile(join(config, "USER.md"), "I am someone with substantial content here.");
    await writeFile(
      join(config, "registry.json"),
      JSON.stringify({
        catalogs: {
          "test-catalog": { path: "/some/path", agents: ["foo", "bar"] },
        },
      }),
    );
    const jm = new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });
    const app = createApp({
      token: "t",
      jobs: jm,
      configRoot: config,
      registryPath: join(config, "registry.json"),
    });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { state: string; agentCount: number };
    expect(body.state).toBe("HOME");
    expect(body.agentCount).toBe(2);
  });
});
