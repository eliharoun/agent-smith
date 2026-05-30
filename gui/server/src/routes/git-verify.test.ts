import { expect, it } from "bun:test";
import type { GitVerifyResult } from "gui-shared";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerGitVerifyRoute } from "./git-verify";

function makeApp(
  spawnGit: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
) {
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerGitVerifyRoute(app, { gitDeps: { spawnGit } });
  app.onError(errorHandler);
  return app;
}

const auth = { headers: { authorization: "Bearer t" } };

it("POST /api/git/verify-remote returns ok with matching remote", async () => {
  const spawn = async (
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> => {
    if (args.includes("--show-toplevel")) {
      return { stdout: "/repo\n", stderr: "", code: 0 };
    }
    return {
      stdout: "origin\thttps://github.com/foo/bar.git (fetch)\n",
      stderr: "",
      code: 0,
    };
  };
  const app = makeApp(spawn);
  const res = await app.request("/api/git/verify-remote", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      path: "/repo",
      gitRemote: "https://github.com/foo/bar",
    }),
  });
  expect(res.status).toBe(200);
  const j = (await res.json()) as GitVerifyResult;
  expect(j.ok).toBe(true);
});

it("POST /api/git/verify-remote returns remote-mismatch when URL differs", async () => {
  const spawn = async (
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> => {
    if (args.includes("--show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
    return {
      stdout: "origin\thttps://github.com/other/repo.git (fetch)\n",
      stderr: "",
      code: 0,
    };
  };
  const app = makeApp(spawn);
  const res = await app.request("/api/git/verify-remote", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      path: "/repo",
      gitRemote: "https://github.com/foo/bar",
    }),
  });
  const j = (await res.json()) as GitVerifyResult;
  expect(j.ok).toBe(false);
  if (j.ok === false) expect(j.reason).toBe("remote-mismatch");
});

it("POST /api/git/verify-remote returns not-a-git-repo when rev-parse fails", async () => {
  const spawn = async (): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }> => ({ stdout: "", stderr: "fatal", code: 128 });
  const app = makeApp(spawn);
  const res = await app.request("/api/git/verify-remote", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ path: "/nope" }),
  });
  const j = (await res.json()) as GitVerifyResult;
  expect(j.ok).toBe(false);
  if (j.ok === false) expect(j.reason).toBe("not-a-git-repo");
});

it("POST /api/git/verify-remote honors skipGitCheck", async () => {
  let called = false;
  const spawn = async (): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }> => {
    called = true;
    return { stdout: "", stderr: "", code: 0 };
  };
  const app = makeApp(spawn);
  const res = await app.request("/api/git/verify-remote", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ path: "/whatever", skipGitCheck: true }),
  });
  expect(res.status).toBe(200);
  const j = (await res.json()) as { ok: boolean; skipped: boolean };
  expect(j.ok).toBe(true);
  expect(j.skipped).toBe(true);
  expect(called).toBe(false);
});

it("POST /api/git/verify-remote returns 400 on missing path", async () => {
  const spawn = async (): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }> => ({ stdout: "", stderr: "", code: 0 });
  const app = makeApp(spawn);
  const res = await app.request("/api/git/verify-remote", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});
