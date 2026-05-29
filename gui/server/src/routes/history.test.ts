import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerHistoryRoute } from "./history";

let dir: string;
let jsonlPath: string;
let outputDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hr-"));
  jsonlPath = join(dir, "g.jsonl");
  outputDir = join(dir, "out");
  await mkdir(outputDir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newApp() {
  const app = new Hono();
  registerHistoryRoute(app, { jsonlPath, outputDir });
  return app;
}

describe("GET /api/history", () => {
  it("returns [] when no jsonl file", async () => {
    const res = await newApp().request("/api/history");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns paginated entries newest first", async () => {
    const entries = [
      {
        id: "a",
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: 1,
        endedAt: 2,
        exitCode: 0,
        durationMs: 1,
        outputAvailable: false,
      },
      {
        id: "b",
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: 3,
        endedAt: 4,
        exitCode: 0,
        durationMs: 1,
        outputAvailable: false,
      },
      {
        id: "c",
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: 5,
        endedAt: 6,
        exitCode: 0,
        durationMs: 1,
        outputAvailable: false,
      },
    ];
    await writeFile(jsonlPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const res = await newApp().request("/api/history?limit=2");
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((e) => e.id)).toEqual(["c", "b"]);
  });
});

describe("GET /api/history/:id/output", () => {
  it("404 when log missing", async () => {
    const res = await newApp().request("/api/history/missing/output");
    expect(res.status).toBe(404);
  });

  it("returns text content when present", async () => {
    await writeFile(join(outputDir, "j1.log"), "hello\n");
    const res = await newApp().request("/api/history/j1/output");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("hello\n");
  });
});

describe("GET /api/history/search", () => {
  it("400 when q missing", async () => {
    const res = await newApp().request("/api/history/search");
    expect(res.status).toBe(400);
  });

  it("returns hits", async () => {
    await writeFile(join(outputDir, "j1.log"), "alpha\nERROR: oops\ngamma\n");
    const res = await newApp().request("/api/history/search?q=ERROR&limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      jobId: string;
      matchedLine: string;
    }>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toMatchObject({ jobId: "j1", matchedLine: "ERROR: oops" });
  });
});
