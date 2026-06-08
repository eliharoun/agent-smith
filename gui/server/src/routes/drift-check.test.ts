import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform } from "../../../shared/src/index";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import type { DryRunOutput } from "../services/render-dry-run";
import { registerDriftCheckRoute } from "./drift-check";
import type { InstallStateEntry } from "./install-state";

let home: string;
let registryPath: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "drift-check-"));
  registryPath = join(home, "registry.json");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

interface SetupOpts {
  manifestEntries?: InstallStateEntry[];
  dryRun?: () => Promise<DryRunOutput>;
}

function setup(opts: SetupOpts) {
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerDriftCheckRoute(app, {
    agentSmithHome: home,
    registryPath,
    loadEntries: async () => opts.manifestEntries ?? [],
    ...(opts.dryRun
      ? { renderDryRun: async () => (opts.dryRun as () => Promise<DryRunOutput>)() }
      : {}),
  });
  app.onError(errorHandler);
  return app;
}

const auth = { headers: { authorization: "Bearer t" } };

describe("GET /api/agents/:name/drift-check", () => {
  it("returns drifted: [] when there are no install-state entries", async () => {
    const app = setup({ manifestEntries: [] });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    expect(body.drifted).toEqual([]);
  });

  it("returns drifted: [] when fresh hashes match every installed platform", async () => {
    const app = setup({
      manifestEntries: [
        {
          platform: "opencode",
          path: "/x/alpha.md",
          contentHash: "sha256:111",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "main",
        },
        {
          platform: "claude-code",
          path: "/x/alpha-claude.md",
          contentHash: "sha256:222",
          installedAt: "2026-06-04T00:00:01Z",
          kind: "main",
        },
      ],
      dryRun: async () => ({
        hashes: [
          { platform: "opencode", relativePath: "alpha.md", kind: "main", hash: "sha256:111" },
          {
            platform: "claude-code",
            relativePath: "alpha.md",
            kind: "main",
            hash: "sha256:222",
          },
        ],
      }),
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    expect(body.drifted).toEqual([]);
  });

  it("reports a single drifted platform when one hash mismatches", async () => {
    const app = setup({
      manifestEntries: [
        {
          platform: "opencode",
          path: "/x/alpha.md",
          contentHash: "sha256:OLD",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "main",
        },
        {
          platform: "claude-code",
          path: "/x/alpha-claude.md",
          contentHash: "sha256:222",
          installedAt: "2026-06-04T00:00:01Z",
          kind: "main",
        },
      ],
      dryRun: async () => ({
        hashes: [
          { platform: "opencode", relativePath: "alpha.md", kind: "main", hash: "sha256:NEW" },
          {
            platform: "claude-code",
            relativePath: "alpha.md",
            kind: "main",
            hash: "sha256:222",
          },
        ],
      }),
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    expect(body.drifted).toEqual(["opencode"]);
  });

  it("reports multiple drifted platforms when multiple hashes mismatch", async () => {
    const app = setup({
      manifestEntries: [
        {
          platform: "opencode",
          path: "/x/alpha.md",
          contentHash: "sha256:OLD1",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "main",
        },
        {
          platform: "claude-code",
          path: "/x/alpha-claude.md",
          contentHash: "sha256:OLD2",
          installedAt: "2026-06-04T00:00:01Z",
          kind: "main",
        },
      ],
      dryRun: async () => ({
        hashes: [
          { platform: "opencode", relativePath: "alpha.md", kind: "main", hash: "sha256:NEW1" },
          {
            platform: "claude-code",
            relativePath: "alpha.md",
            kind: "main",
            hash: "sha256:NEW2",
          },
        ],
      }),
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    // Sorted for stable client consumption.
    expect(body.drifted).toEqual(["claude-code", "opencode"]);
  });

  it("treats sidecar manifest entries as not contributing to drift", async () => {
    const app = setup({
      manifestEntries: [
        // Sidecar entry only — no main. Should not produce any drift call.
        {
          platform: "codex",
          path: "/x/alpha/agents/openai.yaml",
          contentHash: "sha256:side",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "sidecar",
        },
      ],
      dryRun: async () => ({
        hashes: [],
      }),
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    expect(body.drifted).toEqual([]);
  });

  it("reports a platform as drifted when bundle no longer renders for it", async () => {
    const app = setup({
      manifestEntries: [
        {
          platform: "opencode",
          path: "/x/alpha.md",
          contentHash: "sha256:111",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "main",
        },
      ],
      // Bundle was edited to drop "opencode" from targets — dry-run yields no
      // hash for that platform. The installed file is now stale.
      dryRun: async () => ({ hashes: [] }),
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: Platform[] };
    expect(body.drifted).toEqual(["opencode"]);
  });

  it("returns 500 with the error message when render fails", async () => {
    const app = setup({
      manifestEntries: [
        {
          platform: "opencode",
          path: "/x/alpha.md",
          contentHash: "sha256:111",
          installedAt: "2026-06-04T00:00:00Z",
          kind: "main",
        },
      ],
      dryRun: async () => {
        throw new Error("agent.config.json validation failed: name is required");
      },
    });
    const res = await app.request("/api/agents/alpha/drift-check", auth);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("RENDER_FAILED");
    expect(body.error).toContain("validation failed");
  });

  it("returns 400 on agent names containing path-traversal sequences", async () => {
    const app = setup({});
    const res = await app.request("/api/agents/%2E%2E%2Fother/drift-check", auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_NAME");
  });

  it("requires the bearer token", async () => {
    const app = setup({});
    const res = await app.request("/api/agents/alpha/drift-check");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/agents/:name/drift-check (integration via createApp)", () => {
  // Smoke test that the route is registered through createApp wiring,
  // proving the app.ts change works end-to-end. Empty manifest path is
  // safe because the underlying file is absent in the freshly-created
  // tmpdir, mirroring a fresh-install user.
  it("is reachable at the documented path with an empty manifest", async () => {
    const { createApp } = await import("../app");
    const home = await mkdtemp(join(tmpdir(), "drift-app-"));
    try {
      await writeFile(
        join(home, "registry.json"),
        JSON.stringify({ schemaVersion: 1, catalogs: {} }),
      );
      const app = createApp({
        token: "t",
        agentSmithHome: home,
        registryPath: join(home, "registry.json"),
      });
      const res = await app.request("/api/agents/anything/drift-check", auth);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { drifted: Platform[] };
      expect(body.drifted).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
