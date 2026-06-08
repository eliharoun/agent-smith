import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UserMdContent } from "../../../shared/src/index";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";

export interface UserMdDeps {
  configRoot: string;
}

export function registerUserMdRoute(app: Hono, deps: UserMdDeps) {
  const path = join(deps.configRoot, "USER.md");

  app.get("/api/user-md", async (c) => {
    try {
      const content = await readFile(path, "utf8");
      return c.json({ content });
    } catch {
      // file may not exist yet on first-run; return empty
      return c.json({ content: "" });
    }
  });

  app.put("/api/user-md", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = UserMdContent.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, parsed.data.content, "utf8");
    return c.json({ ok: true });
  });
}
