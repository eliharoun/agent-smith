import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";

let root: string;
let registryPath: string;
const fakeSpawner = () => ({ stop: () => {}, writeStdin: () => {} });

function appWith(): ReturnType<typeof createApp> {
  const jm = new JobManager({ spawner: fakeSpawner });
  return createApp({ token: "t", jobs: jm, registryPath });
}
const auth = { authorization: "Bearer t" };
// State-changing /api/* requests must carry a same-origin header (originGuard,
// C4.3.2). createApp defaults allowedOrigin to this sentinel in tests.
const writeHeaders = {
  authorization: "Bearer t",
  "Content-Type": "application/json",
  origin: "http://localhost.test",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "protected-routes-"));
  registryPath = join(root, "registry.json");
  await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("GUI server protects agent-smith and bundled skills", () => {
  it("PUT /api/agents/agent-smith/persona/IDENTITY → 403 PROTECTED_BUNDLE", async () => {
    const res = await appWith().request("/api/agents/agent-smith/persona/IDENTITY", {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ content: "hacked" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROTECTED_BUNDLE");
  });

  it("PUT /api/agents/agent-smith/config → 403 PROTECTED_BUNDLE", async () => {
    const res = await appWith().request("/api/agents/agent-smith/config", {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ targets: ["opencode"] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROTECTED_BUNDLE");
  });

  it("PUT persona on a non-protected agent is NOT 403 (404 not-in-registry instead)", async () => {
    const res = await appWith().request("/api/agents/my-agent/persona/IDENTITY", {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).not.toBe(403);
  });

  it("POST /api/jobs agent.uninstall name=agent-smith → 403", async () => {
    const res = await appWith().request("/api/jobs", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        command: "agent.uninstall",
        name: "agent-smith",
        platforms: ["claude-code"],
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROTECTED_BUNDLE");
  });

  it("POST /api/jobs knowledge.remove agent=agent-smith → 403", async () => {
    const res = await appWith().request("/api/jobs", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        command: "knowledge.remove",
        agent: "agent-smith",
        sourceId: "anything",
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROTECTED_BUNDLE");
  });

  it("POST /api/jobs skill.uninstall name=the-architect → 403", async () => {
    const res = await appWith().request("/api/jobs", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ command: "skill.uninstall", name: "the-architect" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROTECTED_BUNDLE");
  });

  it("POST /api/jobs agent.uninstall for a user agent is NOT blocked (no 403)", async () => {
    const res = await appWith().request("/api/jobs", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        command: "agent.uninstall",
        name: "my-agent",
        platforms: ["opencode"],
      }),
    });
    expect(res.status).not.toBe(403);
  });

  it("GET /api/status includes a boolean cloneMode", async () => {
    const res = await appWith().request("/api/status", { headers: auth });
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).cloneMode).toBe("boolean");
  });
});
