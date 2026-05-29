import type { Hono } from "hono";
import { parseRegistry } from "../services/parse-registry";

export function registerRegistryRoute(app: Hono, opts: { registryPath: string }) {
  app.get("/api/registry", async (c) => {
    const reg = await parseRegistry(opts.registryPath);
    return c.json(reg);
  });
}
