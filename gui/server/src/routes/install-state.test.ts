import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";

let home: string;
let registryPath: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "install-state-"));
  registryPath = join(home, "registry.json");
  await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, catalogs: {} }));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeManifest(entries: object[]) {
  await writeFile(
    join(home, "installed-agents.json"),
    JSON.stringify({ schemaVersion: 1, installed: entries }, null, 2),
  );
}

describe("GET /api/agents/:name/install-state", () => {
  it("returns 200 with empty entries when installed-agents.json does not exist", async () => {
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("returns 200 with empty entries when manifest exists but no entries match the agent", async () => {
    await writeManifest([
      {
        name: "beta",
        platform: "opencode",
        path: "/x/beta.md",
        contentHash: "sha256:abc",
        installedAt: "2026-06-04T00:00:00Z",
        kind: "main",
      },
    ]);
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("filters manifest entries to the requested agent only", async () => {
    await writeManifest([
      {
        name: "alpha",
        platform: "opencode",
        path: "/x/alpha.md",
        contentHash: "sha256:111",
        installedAt: "2026-06-04T00:00:00Z",
        kind: "main",
      },
      {
        name: "alpha",
        platform: "claude-code",
        path: "/x/alpha-claude.md",
        contentHash: "sha256:222",
        installedAt: "2026-06-04T00:00:01Z",
        kind: "main",
      },
      {
        name: "beta",
        platform: "opencode",
        path: "/x/beta.md",
        contentHash: "sha256:333",
        installedAt: "2026-06-04T00:00:02Z",
        kind: "main",
      },
    ]);
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ platform: string; contentHash: string; kind: string }>;
    };
    expect(body.entries.length).toBe(2);
    const platforms = body.entries.map((e) => e.platform).sort();
    expect(platforms).toEqual(["claude-code", "opencode"]);
    expect(body.entries.every((e) => e.kind === "main")).toBe(true);
  });

  it("includes both main and sidecar entries when present", async () => {
    await writeManifest([
      {
        name: "alpha",
        platform: "codex",
        path: "/x/alpha/SKILL.md",
        contentHash: "sha256:main",
        installedAt: "2026-06-04T00:00:00Z",
        kind: "main",
      },
      {
        name: "alpha",
        platform: "codex",
        path: "/x/alpha/agents/openai.yaml",
        contentHash: "sha256:side",
        installedAt: "2026-06-04T00:00:01Z",
        kind: "sidecar",
      },
    ]);
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ kind: string }>;
    };
    expect(body.entries.length).toBe(2);
    expect(body.entries.map((e) => e.kind).sort()).toEqual(["main", "sidecar"]);
  });

  it("defaults `kind` to main for legacy entries missing the field", async () => {
    await writeManifest([
      {
        name: "alpha",
        platform: "opencode",
        path: "/x/alpha.md",
        contentHash: "sha256:legacy",
        installedAt: "2026-06-04T00:00:00Z",
        // no kind field — pre-sidecar manifest entry
      },
    ]);
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ kind: string }> };
    expect(body.entries[0]!.kind).toBe("main");
  });

  it("returns 400 on agent names containing path-traversal sequences", async () => {
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    // %2E%2E%2F decodes to "../" — must be rejected before any fs read.
    const res = await app.request("/api/agents/%2E%2E%2Fother/install-state", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_NAME");
  });

  it("requires the bearer token", async () => {
    const app = createApp({ token: "t", agentSmithHome: home, registryPath });
    const res = await app.request("/api/agents/alpha/install-state");
    expect(res.status).toBe(401);
  });
});
