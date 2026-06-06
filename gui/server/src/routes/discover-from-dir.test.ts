import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDiscoverFromDirRoute } from "./discover-from-dir";

describe("POST /api/agents/discover-from-dir", () => {
  test("returns 200 and a discovery envelope for a valid local directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "discover-from-dir-"));
    try {
      const bundleDir = join(dir, "agents", "test-bundle");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "test-bundle",
          description: "Use proactively as a discover-from-dir test fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
        }),
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
        await writeFile(join(bundleDir, f), "placeholder\n");
      }
      const app = new Hono();
      registerDiscoverFromDirRoute(app, {
        runSmith: async () => ({
          code: 0,
          stdout: JSON.stringify({
            kind: "agent",
            bundles: [{ name: "test-bundle", description: "...", alreadyInstalled: false }],
            detectedTargets: ["claude-code"],
            catalog: { rootPath: dir },
          }),
          stderr: "",
        }),
      });
      const res = await app.request("/api/agents/discover-from-dir", {
        method: "POST",
        body: JSON.stringify({ path: dir }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bundles: Array<{ name: string }> };
      expect(body.bundles.some((b) => b.name === "test-bundle")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns 400 when path is missing", async () => {
    const app = new Hono();
    registerDiscoverFromDirRoute(app, {
      runSmith: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    const res = await app.request("/api/agents/discover-from-dir", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 when path is not an existing directory", async () => {
    const app = new Hono();
    registerDiscoverFromDirRoute(app, {
      runSmith: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    const res = await app.request("/api/agents/discover-from-dir", {
      method: "POST",
      body: JSON.stringify({ path: "/does/not/exist" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
