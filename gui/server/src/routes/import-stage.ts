import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BYTES = 200 * 1024 * 1024; // 200MB upper bound

export function registerImportStageRoute(app: Hono): void {
  app.post("/api/import/stage", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400 as ContentfulStatusCode);
    }
    if (!file.name.endsWith(".smith-bundle.tgz")) {
      return c.json(
        { error: "expected .smith-bundle.tgz" },
        400 as ContentfulStatusCode,
      );
    }
    if (file.size > MAX_BYTES) {
      return c.json(
        { error: "archive too large (>200MB)" },
        413 as ContentfulStatusCode,
      );
    }
    const dir = await mkdtemp(join(tmpdir(), "smith-import-"));
    // Always write to a fixed name so a crafted file.name cannot escape the temp dir.
    const out = join(dir, "uploaded.smith-bundle.tgz");
    await writeFile(out, Buffer.from(await file.arrayBuffer()));
    return c.json({ path: out });
  });
}
