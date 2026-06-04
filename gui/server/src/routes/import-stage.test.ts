import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerImportStageRoute } from "./import-stage";

describe("POST /api/import/stage", () => {
  test("rejects non-tgz files with 400", async () => {
    const app = new Hono();
    registerImportStageRoute(app);
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0])], "evil.txt"));
    const res = await app.request("/api/import/stage", { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(".smith-bundle.tgz");
  });

  test("rejects requests with no file with 400", async () => {
    const app = new Hono();
    registerImportStageRoute(app);
    const fd = new FormData();
    const res = await app.request("/api/import/stage", { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("accepts a valid .smith-bundle.tgz and returns a stage path", async () => {
    const app = new Hono();
    registerImportStageRoute(app);
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0x1f, 0x8b])], "test.smith-bundle.tgz"));
    const res = await app.request("/api/import/stage", { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toMatch(/uploaded\.smith-bundle\.tgz$/);
  });

  test("(finding 2) ignores a crafted file.name with path traversal", async () => {
    // The server must use a fixed safe filename, not file.name from the upload.
    const app = new Hono();
    registerImportStageRoute(app);
    const fd = new FormData();
    fd.append(
      "file",
      new File([new Uint8Array([0x1f, 0x8b])], "../evil.smith-bundle.tgz"),
    );
    const res = await app.request("/api/import/stage", { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    // Must use the fixed safe name, not the attacker-supplied traversal name.
    expect(body.path).toMatch(/uploaded\.smith-bundle\.tgz$/);
    expect(body.path).not.toContain("..");
  });
});
