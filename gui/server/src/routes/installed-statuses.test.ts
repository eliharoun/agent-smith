import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform } from "../../../shared/src/index";
import { createApp } from "../app";

let root: string;
let registryPath: string;

async function writeBundle(catalog: string, name: string) {
  const path = join(root, "catalogs", catalog, name);
  await mkdir(path, { recursive: true });
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(path, f), `# ${f}\nbody\n`);
  }
  await writeFile(
    join(path, "agent.config.json"),
    JSON.stringify({ name, description: "test", model: "sonnet", targets: ["opencode"] }),
  );
  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "is-bulk-"));
  registryPath = join(root, "registry.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("GET /api/agents/installed-statuses", () => {
  it("returns a record of agentName → InstalledStatus for every registered agent", async () => {
    await writeBundle("local", "alpha");
    await writeBundle("local", "beta");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: {
          local: { path: join(root, "catalogs", "local"), agents: ["alpha", "beta"] },
        },
      }),
    );

    const installRoot = await mkdtemp(join(tmpdir(), "is-paths-"));
    try {
      // Pre-create alpha's opencode artifact as a real FILE (the new
      // probe uses Bun.file().exists() and treats directories as absent).
      // Leave beta empty.
      await mkdir(installRoot, { recursive: true });
      await writeFile(join(installRoot, "alpha-opencode"), "");
      const installPathsFor = (name: string): Record<Platform, string> => ({
        opencode: join(installRoot, `${name}-opencode`),
        "claude-code": join(installRoot, `${name}-claude`),
        codex: join(installRoot, `${name}-codex`),
      });

      const app = createApp({ token: "t", registryPath, installPathsFor });
      const res = await app.request("/api/agents/installed-statuses", {
        headers: { Authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<
        string,
        { agent: string; installed: Record<Platform, boolean> }
      >;
      expect(body.alpha).toBeDefined();
      expect(body.alpha.agent).toBe("alpha");
      expect(body.alpha.installed.opencode).toBe(true);
      expect(body.alpha.installed["claude-code"]).toBe(false);
      expect(body.beta).toBeDefined();
      expect(body.beta.installed.opencode).toBe(false);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty object when there are no agents", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const app = createApp({ token: "t", registryPath });
    const res = await app.request("/api/agents/installed-statuses", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });
});
