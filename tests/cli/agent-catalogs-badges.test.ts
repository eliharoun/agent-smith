// tests/cli/agent-catalogs-badges.test.ts
//
// RC2-6: `smith agent catalogs` output includes [managed]/[linked] chip
// between the kind chip and the path arrow.
//
// Format: <label> [<kind>] [managed|linked] → <rootPath> [(git: <url>)]

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCatalogs } from "../../src/cli/commands/agent/catalogs";
import { addSource, loadRegistry, saveRegistry } from "../../src/io/registry";

let dir: string;
let registryPath: string;

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(
      args
        .map((a) => String(a))
        // Strip ANSI for substring matching.
        .join(" ")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
        .replace(/\x1b\[[0-9;]*m/g, ""),
    );
  };
  return { lines, restore: () => { console.log = orig; } };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-catalogs-badges-"));
  registryPath = join(dir, "registry.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("smith agent catalogs — mode badge [v1-task RC2-6]", () => {
  test("default registry: user-global shown with [linked] badge", async () => {
    // loadRegistry seeds a default user-global entry when the file is missing;
    // verify the new [linked] chip renders there (regression guard for the
    // out-of-the-box experience).
    const cap = captureStdout();
    try {
      await agentCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("user-global"));
    expect(line).toBeTruthy();
    expect(line).toContain("[user-global]");
    expect(line).toContain("[linked]");
  });

  test("managed catalog (has remote): shows [managed] and (git: <url>)", async () => {
    const reg0 = await loadRegistry(registryPath);
    const added = addSource(reg0, {
      kind: "registered",
      label: "owner/repo",
      rootPath: "/tmp/managed-x",
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
    if (added.status !== "added") throw new Error("seed failed");
    await saveRegistry(registryPath, added.registry);

    const cap = captureStdout();
    try {
      await agentCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("owner/repo"));
    expect(line).toBeTruthy();
    expect(line).toContain("[registered]");
    expect(line).toContain("[managed]");
    expect(line).toContain("(git: https://github.com/owner/repo)");
  });

  test("linked catalog (no remote): shows [linked] and no (git: …) suffix", async () => {
    const reg0 = await loadRegistry(registryPath);
    const added = addSource(reg0, {
      kind: "user-global",
      label: "local-only",
      rootPath: "/tmp/linked-x",
    });
    if (added.status !== "added") throw new Error("seed failed");
    await saveRegistry(registryPath, added.registry);

    const cap = captureStdout();
    try {
      await agentCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    const line = cap.lines.find((l) => l.includes("local-only"));
    expect(line).toBeTruthy();
    expect(line).toContain("[user-global]");
    expect(line).toContain("[linked]");
    expect(line).not.toContain("(git:");
  });

  test("mixed: both badges render in stable order", async () => {
    let reg = await loadRegistry(registryPath);
    let r = addSource(reg, {
      kind: "registered",
      label: "managed/x",
      rootPath: "/tmp/m",
      gitRemote: "https://github.com/o/r",
      remote: {
        url: "https://github.com/o/r",
        ref: "main",
        lastPulledSha: "b".repeat(40),
        lastPulledAt: new Date().toISOString(),
        lastRemoteSha: "b".repeat(40),
        lastCheckedAt: new Date().toISOString(),
      },
    });
    if (r.status !== "added") throw new Error("seed1");
    reg = r.registry;
    r = addSource(reg, {
      kind: "user-global",
      label: "linked/x",
      rootPath: "/tmp/l",
    });
    if (r.status !== "added") throw new Error("seed2");
    await saveRegistry(registryPath, r.registry);

    const cap = captureStdout();
    try {
      await agentCatalogs({ registryPath });
    } finally {
      cap.restore();
    }
    expect(cap.lines.find((l) => l.includes("managed/x"))).toContain("[managed]");
    expect(cap.lines.find((l) => l.includes("linked/x"))).toContain("[linked]");
  });
});
