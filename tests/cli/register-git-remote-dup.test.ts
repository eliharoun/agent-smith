// tests/cli/register-git-remote-dup.test.ts
//
// RC2-5: `smith agent|skill register --git-remote <url>` warns (stderr)
// and proceeds when <url> matches an existing source's remote URL.
// User is explicitly opting into a multi-path alias for the same upstream;
// not blocked (unlike install --from which hard-errors per RC2-4).
//
// Uses XDG-isolated home dir so both agent + skill registries route through
// the canonical paths and the warn-on-dup code can find pre-seeded entries
// without each verb taking explicit cross-registry seams.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "../../src/cli/commands/register";
import { skillRegister } from "../../src/cli/commands/skill/register";
import {
  addSource,
  canonicalRegistryPath,
  loadRegistry,
  saveRegistry,
} from "../../src/io/registry";

let home: string;
let dir: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "register-dup-url-"));
  dir = await mkdtemp(join(tmpdir(), "register-dup-url-work-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

const fakeRunGit = (originUrl: string) => async (args: string[]) => {
  if (args[0] === "rev-parse") return "/fake";
  if (args[0] === "remote") return `origin\t${originUrl} (fetch)`;
  throw new Error(`unreachable: git ${args.join(" ")}`);
};

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.error = orig;
    },
  };
}

async function seedAgentSource(label: string, gitRemote: string): Promise<void> {
  const reg0 = await loadRegistry(canonicalRegistryPath());
  const seeded = addSource(reg0, {
    kind: "registered",
    label,
    rootPath: `/tmp/seed-${label.replace(/\//g, "-")}`,
    gitRemote,
  });
  if (seeded.status !== "added") throw new Error("seed failed");
  await saveRegistry(canonicalRegistryPath(), seeded.registry);
}

describe("smith agent register --git-remote duplicate URL [v1-task RC2-5]", () => {
  test("warns when URL matches existing source, but proceeds", async () => {
    await seedAgentSource("preexisting/x", "https://github.com/owner/repo.git");

    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");

    const cap = captureStderr();
    try {
      const rc = await register(target, {
        kind: "registered",
        label: "alias/x",
        gitRemote: "https://github.com/owner/repo",
        runGit: fakeRunGit("https://github.com/owner/repo.git"),
      });
      expect(rc).toBe(0);
    } finally {
      cap.restore();
    }

    expect(cap.lines.some((l) => l.includes("preexisting/x"))).toBe(true);
    expect(
      cap.lines.some(
        (l) =>
          l.toLowerCase().includes("alias") ||
          l.toLowerCase().includes("already tracks") ||
          l.toLowerCase().includes("same git remote"),
      ),
    ).toBe(true);

    const after = await loadRegistry(canonicalRegistryPath());
    const found = after.sources.find((s) => s.label === "alias/x");
    expect(found).toBeTruthy();
  });

  test("no warning when URL is novel", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");

    const cap = captureStderr();
    try {
      await register(target, {
        kind: "registered",
        label: "fresh/x",
        gitRemote: "https://github.com/owner/repo",
        runGit: fakeRunGit("https://github.com/owner/repo.git"),
      });
    } finally {
      cap.restore();
    }

    expect(
      cap.lines.filter(
        (l) =>
          l.toLowerCase().includes("already tracks") || l.toLowerCase().includes("alias"),
      ).length,
    ).toBe(0);
  });
});

describe("smith skill register --git-remote duplicate URL [v1-task RC2-5]", () => {
  test("warns when URL matches existing agent source, but proceeds", async () => {
    await seedAgentSource("agent-side/x", "https://github.com/owner/repo.git");

    const target = join(dir, "skills");
    await mkdir(join(target, "skill-a"), { recursive: true });
    await writeFile(join(target, "skill-a/SKILL.md"), "---\nname: skill-a\n---\n");

    const cap = captureStderr();
    try {
      await skillRegister(target, {
        kind: "team-shared",
        label: "skill-alias/x",
        gitRemote: "https://github.com/owner/repo",
        runGit: fakeRunGit("https://github.com/owner/repo.git"),
      });
    } finally {
      cap.restore();
    }

    expect(cap.lines.some((l) => l.includes("agent-side/x"))).toBe(true);
  });
});

