import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { discoverFromUrlHandler, registerSkillsRoute } from "./skills";

describe("discoverFromUrlHandler ref flag is per-kind", () => {
  test("skill uses --git-ref, agent uses --ref", async () => {
    const seen: string[][] = [];
    const capture = async (args: string[]) => {
      seen.push(args);
      return { stdout: "{}", stderr: "", code: 0 };
    };
    await discoverFromUrlHandler("skill", { url: "https://github.com/o/r", ref: "main" }, capture);
    await discoverFromUrlHandler("agent", { url: "https://github.com/o/r", ref: "main" }, capture);
    expect(seen[0]).toContain("--git-ref");
    expect(seen[0]).not.toContain("--ref");
    expect(seen[1]).toContain("--ref");
    expect(seen[1]).not.toContain("--git-ref");
  });
});

function appWith(run: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>) {
  const app = new Hono();
  registerSkillsRoute(app, { skillRegistryPath: "/tmp/none.json", installedSkillsPath: "/tmp/none2.json", runSmith: run });
  return app;
}

describe("POST /api/skills/discover-from-url", () => {
  test("returns parsed discovery JSON from the CLI", async () => {
    const payload = { kind: "skill", bundles: [{ name: "a", description: "d", alreadyInstalled: false }], detectedTargets: ["opencode"], catalog: { suggestedLabel: "o/r", rootPath: "/x" }, remote: { host: "github.com", owner: "o", repo: "r", sha: "s" }, existingCatalog: null };
    const app = appWith(async () => ({ stdout: JSON.stringify(payload), stderr: "", code: 0 }));
    const res = await app.request("/api/skills/discover-from-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/o/r" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).bundles[0].name).toBe("a");
  });
  test("rejects file:// URLs", async () => {
    const app = appWith(async () => ({ stdout: "", stderr: "", code: 0 }));
    const res = await app.request("/api/skills/discover-from-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "file:///tmp/x" }) });
    expect(res.status).toBe(400);
  });
  test("maps a CLI {error} payload to an HTTP error", async () => {
    const app = appWith(async () => ({ stdout: JSON.stringify({ error: { code: "git-clone-failed", message: "auth required" } }), stderr: "", code: 2 }));
    const res = await app.request("/api/skills/discover-from-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/o/private" }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).code).toBe("git-clone-failed");
  });
});
