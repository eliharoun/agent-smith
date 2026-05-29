// gui/server/src/services/load-remotes.test.ts
//
// C4.1.4 (v1-task): build the rootPath→RemoteBlock lookup that
// agentWithRemote / skillWithRemote need. Reads the on-disk CLI registries
// (registry.json schemaVersion: 2 for agents, skill-catalogs.json
// schemaVersion: 2 for skills) and extracts the optional `remote` blocks.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentRemotes, loadSkillRemotes } from "./load-remotes";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "load-remotes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadAgentRemotes (C4.1.4)", () => {
  it("returns empty Map when file missing", async () => {
    expect(await loadAgentRemotes(join(dir, "nope.json"))).toEqual(new Map());
  });

  it("returns empty Map when no sources have a remote block", async () => {
    const path = join(dir, "registry.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        sources: [{ kind: "user-local", rootPath: "/a/b", label: "local" }],
      }),
    );
    expect(await loadAgentRemotes(path)).toEqual(new Map());
  });

  it("extracts remote blocks keyed by rootPath", async () => {
    const path = join(dir, "registry.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        sources: [
          {
            kind: "registered",
            rootPath: "/abs/remote/github.com/o/r",
            label: "team",
            gitRemote: "https://github.com/o/r.git",
            remote: {
              url: "https://github.com/o/r.git",
              ref: "main",
              lastPulledSha: "a".repeat(40),
              lastPulledAt: "2026-05-25T10:00:00.000Z",
            },
          },
          { kind: "user-local", rootPath: "/abs/local", label: "local" },
        ],
      }),
    );
    const remotes = await loadAgentRemotes(path);
    expect(remotes.size).toBe(1);
    expect(remotes.get("/abs/remote/github.com/o/r")?.url).toBe("https://github.com/o/r.git");
    expect(remotes.get("/abs/remote/github.com/o/r")?.lastPulledSha).toBe("a".repeat(40));
  });

  it("silently skips malformed remote blocks (defense-in-depth, never throws)", async () => {
    const path = join(dir, "registry.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        sources: [
          {
            kind: "registered",
            rootPath: "/a/b",
            label: "broken",
            remote: { url: "", ref: "main" }, // empty url → RemoteBlock rejects
          },
        ],
      }),
    );
    expect(await loadAgentRemotes(path)).toEqual(new Map());
  });
});

describe("loadSkillRemotes (C4.1.4)", () => {
  it("returns empty Map when file missing", async () => {
    expect(await loadSkillRemotes(join(dir, "nope.json"))).toEqual(new Map());
  });

  it("extracts remote blocks keyed by rootPath", async () => {
    const path = join(dir, "skill-catalogs.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        catalogs: [
          {
            kind: "team-shared",
            rootPath: "/abs/remote/github.com/o/skills",
            label: "team",
            remote: { url: "https://github.com/o/skills.git", ref: "main" },
          },
          { kind: "user-global", rootPath: "/abs/local", label: "local" },
        ],
      }),
    );
    const remotes = await loadSkillRemotes(path);
    expect(remotes.size).toBe(1);
    expect(remotes.get("/abs/remote/github.com/o/skills")?.url).toBe(
      "https://github.com/o/skills.git",
    );
  });
});
