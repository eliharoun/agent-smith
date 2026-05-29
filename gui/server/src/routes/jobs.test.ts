import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import { JobManager, type Spawner } from "../jobs/job-manager";

const fakeSpawner: Spawner = (_argv, handlers) => {
  handlers.onStdout("hi\n");
  handlers.onExit(0);
  return { stop: () => {}, writeStdin: () => {} };
};

function withAuth(headers: HeadersInit = {}): HeadersInit {
  return { ...headers, authorization: "Bearer test", origin: "http://localhost.test" };
}

describe("jobs routes", () => {
  it("POST /api/jobs validates body via zod", async () => {
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({ token: "test", jobs: jm });
    const res = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ command: "not-a-command" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/jobs starts a job and returns id + preview", async () => {
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({ token: "test", jobs: jm });
    const res = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ command: "doctor" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; preview: string };
    expect(body.jobId).toBeTruthy();
    expect(body.preview).toBe("smith doctor");
  });

  it("POST /api/jobs returns 409 when a lock is held", async () => {
    const jm = new JobManager({
      spawner: (_a, h) => {
        // never call onExit so lock stays held for this test
        h.onStdout("running\n");
        return { stop: () => {}, writeStdin: () => {} };
      },
    });
    const app = createApp({ token: "test", jobs: jm });
    const first = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({
        command: "agent.install",
        name: "foo",
        platforms: ["opencode"],
        withSkills: false,
      }),
    });
    expect(first.status).toBe(202);
    const second = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({
        command: "agent.install",
        name: "foo",
        platforms: ["opencode"],
        withSkills: false,
      }),
    });
    expect(second.status).toBe(409);
  });

  it("GET /api/jobs/:id/stream sets SSE response headers", async () => {
    const jm = new JobManager({
      spawner: (_a, h) => {
        // never exit; we only need headers
        h.onStdout("running\n");
        return { stop: () => {}, writeStdin: () => {} };
      },
    });
    const app = createApp({ token: "test", jobs: jm });
    const post = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ command: "doctor" }),
    });
    const { jobId } = (await post.json()) as { jobId: string };
    const ac = new AbortController();
    const res = await app.request(`/api/jobs/${jobId}/stream`, {
      headers: withAuth(),
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
    expect(res.headers.get("transfer-encoding")).toBe("chunked");
    ac.abort();
  });

  it("GET /api/jobs/:id returns the job record after exit", async () => {
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({ token: "test", jobs: jm });
    const post = await app.request("/api/jobs", {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ command: "doctor" }),
    });
    const { jobId } = (await post.json()) as { jobId: string };
    await jm.waitForExit(jobId);
    const res = await app.request(`/api/jobs/${jobId}`, { headers: withAuth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; exitCode: number };
    expect(body.status).toBe("succeeded");
    expect(body.exitCode).toBe(0);
  });
});
