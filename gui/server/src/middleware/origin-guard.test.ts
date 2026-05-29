// gui/server/src/middleware/origin-guard.test.ts
//
// C4.3.1 (v1-task): tests for the originGuard middleware.

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { originGuard } from "./origin-guard";

function makeApp(allowedOrigin: string) {
  const app = new Hono();
  app.use("*", originGuard({ allowedOrigin }));
  app.all("/api/test", (c) => c.json({ ok: true }));
  return app;
}

describe("originGuard (C4.3.1)", () => {
  it("passes same-origin POST", async () => {
    const app = makeApp("http://localhost:4317");
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { Origin: "http://localhost:4317" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects POST with missing Origin", async () => {
    const app = makeApp("http://localhost:4317");
    const res = await app.request("/api/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("rejects POST with cross-origin Origin", async () => {
    const app = makeApp("http://localhost:4317");
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { Origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("passes GET regardless of Origin (read-only verb)", async () => {
    const app = makeApp("http://localhost:4317");
    const res = await app.request("/api/test", {
      method: "GET",
      headers: { Origin: "http://evil.example" },
    });
    expect(res.status).toBe(200);
  });

  it("passes HEAD/OPTIONS regardless of Origin (read-only verbs)", async () => {
    const app = makeApp("http://localhost:4317");
    for (const method of ["HEAD", "OPTIONS"] as const) {
      const res = await app.request("/api/test", {
        method,
        headers: { Origin: "http://evil.example" },
      });
      // OPTIONS may return 200 (handler matches all verbs); HEAD likewise.
      expect(res.status).toBeLessThan(400);
    }
  });

  it("passes PUT/PATCH/DELETE with same Origin", async () => {
    const app = makeApp("http://localhost:4317");
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const res = await app.request("/api/test", {
        method,
        headers: { Origin: "http://localhost:4317" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("rejects PUT/PATCH/DELETE with cross-origin", async () => {
    const app = makeApp("http://localhost:4317");
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const res = await app.request("/api/test", {
        method,
        headers: { Origin: "http://evil.example" },
      });
      expect(res.status).toBe(403);
    }
  });

  it("rejects when Origin differs only by port (port is part of origin)", async () => {
    const app = makeApp("http://localhost:4317");
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { Origin: "http://localhost:4318" },
    });
    expect(res.status).toBe(403);
  });
});
