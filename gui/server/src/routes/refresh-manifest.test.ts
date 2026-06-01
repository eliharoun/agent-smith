import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";

function setupHome(): string {
  return mkdtempSync(join(tmpdir(), "manifests-"));
}

describe("GET /api/agents/:name/refresh-manifest", () => {
  it("returns granted platforms when manifest exists", async () => {
    const home = setupHome();
    try {
      // CLI convention: <agentSmithHome>/refresh/<agent>/refresh-manifest.json
      mkdirSync(join(home, "refresh", "alpha"), { recursive: true });
      writeFileSync(
        join(home, "refresh", "alpha", "refresh-manifest.json"),
        JSON.stringify({
          agent: "alpha",
          refresh_consent: {
            granted_at: "2026-05-20T00:00:00Z",
            platforms: ["opencode", "codex"],
            sources: [],
          },
        }),
      );
      writeFileSync(
        join(home, "registry.json"),
        JSON.stringify({ schemaVersion: 1, catalogs: {} }),
      );
      const app = createApp({
        token: "t",
        agentSmithHome: home,
        registryPath: join(home, "registry.json"),
      });
      const res = await app.request("/api/agents/alpha/refresh-manifest", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { agent: string; platforms: string[] };
      expect(body.agent).toBe("alpha");
      expect(body.platforms).toEqual(["opencode", "codex"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns empty platforms when manifest absent", async () => {
    const home = setupHome();
    try {
      writeFileSync(
        join(home, "registry.json"),
        JSON.stringify({ schemaVersion: 1, catalogs: {} }),
      );
      const app = createApp({
        token: "t",
        agentSmithHome: home,
        registryPath: join(home, "registry.json"),
      });
      const res = await app.request("/api/agents/alpha/refresh-manifest", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { agent: string; platforms: string[] };
      expect(body.platforms).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns 400 on agent names containing path-traversal sequences", async () => {
    const home = setupHome();
    try {
      writeFileSync(
        join(home, "registry.json"),
        JSON.stringify({ schemaVersion: 1, catalogs: {} }),
      );
      const app = createApp({
        token: "t",
        agentSmithHome: home,
        registryPath: join(home, "registry.json"),
      });
      // %2E%2E%2F decodes to "../" → must be rejected before fs touch.
      const res = await app.request("/api/agents/%2E%2E%2Fother/refresh-manifest", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("INVALID_NAME");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
