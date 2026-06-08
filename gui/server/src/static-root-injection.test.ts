import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGuiServer } from "./index";

describe("startGuiServer staticRoot injection", () => {
  test("serves the SPA from an injected staticRoot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-static-root-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><h1>INJECTED_ROOT</h1>");

    const started = await startGuiServer({
      port: 0,
      bind: "127.0.0.1",
      token: "test-token",
      staticRoot: dir,
    });
    try {
      // Guard the fetch so a server that silently fails to start can't hang the suite.
      const res = await fetch(started.url, { signal: AbortSignal.timeout(3000) }); // url carries ?token=
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toContain("INJECTED_ROOT");
    } finally {
      await started.stop();
    }
  });
});
