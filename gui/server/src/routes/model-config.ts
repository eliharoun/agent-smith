import { PutModelConfigBodySchema } from "../../../shared/src/index";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { type ModelConfigDeps, readModelConfig, writeModelConfig } from "../services/model-config";

export interface ModelConfigRouteDeps extends ModelConfigDeps {}

export function registerModelConfigRoute(app: Hono, deps: ModelConfigRouteDeps): void {
  app.get("/api/model-config", async (c) => {
    return c.json(await readModelConfig(deps));
  });

  app.put("/api/model-config", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PutModelConfigBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    await writeModelConfig(parsed.data, deps);
    return c.json(await readModelConfig(deps));
  });
}
