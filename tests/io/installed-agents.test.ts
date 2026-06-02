import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addInstalledAgent,
  hashContent,
  type InstalledAgent,
  loadInstalledAgents,
  removeInstalledAgent,
  saveInstalledAgents,
} from "../../src/io/installed-agents";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "smith-installed-agents-"));
});
afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe("loadInstalledAgents", () => {
  test("returns empty file when path does not exist", async () => {
    const file = await loadInstalledAgents({ homeDir });
    expect(file).toEqual({ schemaVersion: 1, installed: [] });
  });

  test("returns parsed file when present", async () => {
    const dir = join(homeDir, ".config/agent-smith");
    const path = join(dir, "installed-agents.json");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        installed: [
          {
            name: "x",
            platform: "opencode",
            path: "/abs/x.md",
            contentHash: "sha256:abc",
            installedAt: "2026-05-27T20:00:00.000Z",
          },
        ],
      }),
    );
    const file = await loadInstalledAgents({ homeDir });
    expect(file.installed).toHaveLength(1);
    expect(file.installed[0]?.name).toBe("x");
  });
});

describe("saveInstalledAgents", () => {
  test("writes atomically", async () => {
    const file = {
      schemaVersion: 1 as const,
      installed: [
        {
          name: "y",
          platform: "claude-code" as const,
          path: "/abs/y.md",
          contentHash: "sha256:def",
          installedAt: "2026-05-27T20:00:00.000Z",
        },
      ],
    };
    await saveInstalledAgents(file, { homeDir });
    const path = join(homeDir, ".config/agent-smith/installed-agents.json");
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw)).toEqual(file);
  });
});

describe("addInstalledAgent", () => {
  test("appends a new entry when no match", () => {
    const file = { schemaVersion: 1 as const, installed: [] as InstalledAgent[] };
    const entry: InstalledAgent = {
      name: "n",
      platform: "codex",
      path: "/p",
      contentHash: "sha256:1",
      installedAt: "2026-05-27T20:00:00.000Z",
    };
    const updated = addInstalledAgent(file, entry);
    expect(updated.installed).toHaveLength(1);
    expect(updated.installed[0]).toEqual(entry);
  });

  test("replaces existing entry with same (name, platform, path)", () => {
    // Keying changed alongside sidecar support: re-adding the SAME path
    // for a given (name, platform) replaces in place (idempotent
    // reinstall semantics preserved). Re-adding a DIFFERENT path appends
    // — see the next test.
    const initial: InstalledAgent = {
      name: "n",
      platform: "codex",
      path: "/p1",
      contentHash: "sha256:1",
      installedAt: "2026-05-27T20:00:00.000Z",
    };
    const file = { schemaVersion: 1 as const, installed: [initial] };
    const replacement: InstalledAgent = { ...initial, contentHash: "sha256:2" };
    const updated = addInstalledAgent(file, replacement);
    expect(updated.installed).toHaveLength(1);
    expect(updated.installed[0]?.contentHash).toBe("sha256:2");
  });

  test("appends additional entry when (name, platform) match but path differs", () => {
    // A bundle's main render and its sidecar(s) share (name, platform)
    // but live at distinct paths. Both must coexist in the manifest so
    // the uninstaller can find and remove every file.
    const main: InstalledAgent = {
      name: "n",
      platform: "codex",
      path: "/p/main/SKILL.md",
      contentHash: "sha256:1",
      installedAt: "2026-05-27T20:00:00.000Z",
      kind: "main",
    };
    const sidecar: InstalledAgent = {
      name: "n",
      platform: "codex",
      path: "/p/main/agents/openai.yaml",
      contentHash: "sha256:2",
      installedAt: "2026-05-27T20:00:00.000Z",
      kind: "sidecar",
    };
    const file = { schemaVersion: 1 as const, installed: [main] };
    const updated = addInstalledAgent(file, sidecar);
    expect(updated.installed).toHaveLength(2);
    expect(updated.installed.map((e) => e.path).sort()).toEqual(
      ["/p/main/SKILL.md", "/p/main/agents/openai.yaml"].sort(),
    );
  });
});

describe("removeInstalledAgent", () => {
  test("filters by predicate", () => {
    const e1: InstalledAgent = {
      name: "a",
      platform: "opencode",
      path: "/a",
      contentHash: "sha256:a",
      installedAt: "2026-05-27T20:00:00.000Z",
    };
    const e2: InstalledAgent = { ...e1, name: "b", path: "/b" };
    const file = { schemaVersion: 1 as const, installed: [e1, e2] };
    const updated = removeInstalledAgent(file, (e) => e.name === "a");
    expect(updated.installed).toHaveLength(1);
    expect(updated.installed[0]?.name).toBe("b");
  });
});

describe("hashContent", () => {
  test("produces stable sha256 hex", () => {
    expect(hashContent("hello")).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("differs for different inputs", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});
