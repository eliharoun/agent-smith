// tests/cli/skill-catalogs-badges.test.ts
//
// RC2-6: `smith skill catalogs` mirrors agent: [managed]/[linked] chip
// plus (git: <url>) suffix for managed catalogs. Adhoc/protected flags
// continue to render as before.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillCatalogs } from "../../src/cli/commands/skill/catalogs";
import { addCatalog, loadSkillRegistry, saveSkillRegistry } from "../../src/io/skill-registry";

let dir: string;
let registryPath: string;

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(
      args
        .map((a) => String(a))
        .join(" ")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
        .replace(/\x1b\[[0-9;]*m/g, ""),
    );
  };
  return {
    lines,
    restore: () => {
      console.log = orig;
    },
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skill-catalogs-badges-"));
  registryPath = join(dir, "skill-catalogs.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("smith skill catalogs — mode badge [v1-task RC2-6]", () => {
  test("managed catalog: [managed] + (git: …)", async () => {
    const reg0 = await loadSkillRegistry(registryPath);
    const { registry } = addCatalog(reg0, {
      kind: "team-shared",
      label: "owner/repo",
      rootPath: "/tmp/managed-s",
      gitRemote: "https://github.com/owner/repo",
      remote: {
        url: "https://github.com/owner/repo",
        ref: "main",
        lastPulledSha: "a".repeat(40),
        lastPulledAt: new Date().toISOString(),
        lastRemoteSha: "a".repeat(40),
        lastCheckedAt: new Date().toISOString(),
      },
    });
    await saveSkillRegistry(registryPath, registry);

    const cap = captureStdout();
    try {
      await skillCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("owner/repo"));
    expect(line).toBeTruthy();
    expect(line).toContain("[team-shared]");
    expect(line).toContain("[managed]");
    expect(line).toContain("(git: https://github.com/owner/repo)");
  });

  test("linked catalog: [linked], no (git:)", async () => {
    const reg0 = await loadSkillRegistry(registryPath);
    const { registry } = addCatalog(reg0, {
      kind: "user-global",
      label: "my-local-cat",
      rootPath: "/tmp/linked-s",
    });
    await saveSkillRegistry(registryPath, registry);

    const cap = captureStdout();
    try {
      await skillCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("my-local-cat"));
    expect(line).toBeTruthy();
    expect(line).toContain("[user-global]");
    expect(line).toContain("[linked]");
    expect(line).not.toContain("(git:");
  });

  test("adhoc flag coexists with [linked]", async () => {
    const reg0 = await loadSkillRegistry(registryPath);
    const { registry } = addCatalog(reg0, {
      kind: "user-global",
      label: "adhoc-cat",
      rootPath: "/tmp/adhoc",
      adhoc: true,
    });
    await saveSkillRegistry(registryPath, registry);

    const cap = captureStdout();
    try {
      await skillCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("adhoc-cat"));
    expect(line).toBeTruthy();
    expect(line).toContain("[linked]");
    expect(line).toContain("(adhoc)");
  });
});
