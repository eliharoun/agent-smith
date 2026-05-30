import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";

function makeRegistry(): string {
  const dir = mkdtempSync(join(tmpdir(), "status-test-"));
  writeFileSync(join(dir, "registry.json"), JSON.stringify({ schemaVersion: 1, catalogs: {} }));
  return join(dir, "registry.json");
}

describe("GET /api/status", () => {
  it("returns smithVersion from deps", async () => {
    const registryPath = makeRegistry();
    try {
      const app = createApp({
        token: "t",
        registryPath,
        smithVersion: "9.9.9-test",
      });
      const res = await app.request("/api/status", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { smithVersion: string };
      expect(body.smithVersion).toBe("9.9.9-test");
    } finally {
      rmSync(registryPath.replace(/\/registry\.json$/, ""), { recursive: true, force: true });
    }
  });

  it("falls back to 'unknown' when smithVersion not provided", async () => {
    const registryPath = makeRegistry();
    try {
      const app = createApp({ token: "t", registryPath });
      const res = await app.request("/api/status", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { smithVersion: string };
      expect(body.smithVersion).toBe("unknown");
    } finally {
      rmSync(registryPath.replace(/\/registry\.json$/, ""), { recursive: true, force: true });
    }
  });
});
