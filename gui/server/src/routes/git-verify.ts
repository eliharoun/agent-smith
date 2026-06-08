import { GitVerifyRequest } from "../../../shared/src/index";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { type GitVerifyDeps, verifyGitRemote } from "../services/git-verify";

export interface GitVerifyRouteDeps {
  /** Forwarded to verifyGitRemote(); inject for tests. */
  gitDeps?: GitVerifyDeps;
}

export function registerGitVerifyRoute(app: Hono, routeDeps: GitVerifyRouteDeps = {}): void {
  const gitDeps = routeDeps.gitDeps ?? {};
  app.post("/api/git/verify-remote", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GitVerifyRequest.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    if (parsed.data.skipGitCheck) {
      return c.json({ ok: true as const, skipped: true });
    }
    const result = await verifyGitRemote(parsed.data.path, parsed.data.gitRemote, gitDeps);
    return c.json(result);
  });
}
