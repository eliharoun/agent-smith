import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportsRoute } from "./exports";

describe("POST /api/agents/:name/export/plan", () => {
  test("returns 200 and a manifest preview on dry run", async () => {
    const received: { args: string[] | null } = { args: null };
    const app = new Hono();
    registerExportsRoute(app, {
      runSmith: async (args) => {
        received.args = args;
        return {
          code: 0,
          stdout: JSON.stringify({
            exportSchemaVersion: 1,
            bundle: { name: args[2] ?? "x", contentHash: "0".repeat(64) },
            producedBy: {
              smithVersion: "1.7.0",
              exportedAt: "2026-06-04T15:00:00Z",
              sourceSha: null,
              userAgent: "smith-cli/1.7.0 (test)",
            },
            requires: {
              minSmithVersion: "1.7.0",
              mcpServers: { required: [], peer: [], perAgent: [] },
              credentials: [],
              skills: [],
              remoteKnowledge: [],
            },
            contents: { files: [], knowledgeSnapshots: [], skillBundles: [] },
            omitted: { skills: [] },
          }),
          stderr: "",
        };
      },
    });
    const res = await app.request("/api/agents/code-reviewer/export/plan", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { manifest: { bundle: { name: string } }; defaultExportDir: string };
    expect(body.manifest.bundle.name).toBe("code-reviewer");
    // The route must include the resolved default export directory.
    expect(body.defaultExportDir).toBe(join(homedir(), "Downloads"));
    // Verify the route invokes smith with the canonical dry-run flags.
    expect(received.args).toEqual(["agent", "export", "code-reviewer", "--dry-run", "--json", "--format", "archive"]);
  });

  test("returns 502 when the dry-run fails", async () => {
    const app = new Hono();
    registerExportsRoute(app, {
      runSmith: async () => ({ code: 1, stdout: "", stderr: "bundle not found" }),
    });
    const res = await app.request("/api/agents/x/export/plan", { method: "POST" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("bundle not found");
  });

  test("returns 502 when stdout is not valid JSON", async () => {
    const app = new Hono();
    registerExportsRoute(app, {
      runSmith: async () => ({ code: 0, stdout: "not json", stderr: "" }),
    });
    const res = await app.request("/api/agents/x/export/plan", { method: "POST" });
    expect(res.status).toBe(502);
  });

  test("rejects invalid agent names with 400", async () => {
    const app = new Hono();
    registerExportsRoute(app, { runSmith: async () => ({ code: 0, stdout: "{}", stderr: "" }) });
    const res = await app.request("/api/agents/--help/export/plan", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("plan: rejects unknown format with 400", async () => {
    const app = new Hono();
    registerExportsRoute(app, { runSmith: async () => ({ code: 0, stdout: "{}", stderr: "" }) });
    const res = await app.request("/api/agents/x/export/plan?format=banana", { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("invalid format");
  });

  test("plan: passes --format directory to the CLI when format=directory", async () => {
    const received: { args: string[] | null } = { args: null };
    const app = new Hono();
    registerExportsRoute(app, {
      runSmith: async (args) => {
        received.args = args;
        return { code: 0, stdout: JSON.stringify({ exportSchemaVersion: 1 }), stderr: "" };
      },
    });
    const res = await app.request("/api/agents/my-agent/export/plan?format=directory", { method: "POST" });
    expect(res.status).toBe(200);
    expect(received.args).toContain("--format");
    expect(received.args).toContain("directory");
  });
});
