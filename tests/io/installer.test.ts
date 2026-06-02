import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderedAgent } from "../../src/core/types";
import { type InstallPaths, installRendered } from "../../src/io/installer";
import { loadInstalledAgents } from "../../src/io/installed-agents";

let root: string;
let homeDir: string;
let paths: InstallPaths;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smith-install-"));
  homeDir = mkdtempSync(join(tmpdir(), "smith-install-home-"));
  paths = {
    opencode: join(root, "opencode/agents"),
    "claude-code": join(root, "claude/agents"),
    codex: join(root, "agents/skills"),
    kiro: join(root, "kiro/agents"),
    "agents-md": join(root, "agents-md/agents"),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

const sample: RenderedAgent = {
  target: "opencode",
  format: "markdown-frontmatter",
  relativePath: "demo.md",
  frontmatter: { description: "Use to demo", model: "anthropic/claude-sonnet-4-5" },
  body: "BODY",
};

describe("io/installer", () => {
  test("writes opencode file with frontmatter and body", async () => {
    const result = await installRendered([sample], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
    const written = await readFile(join(paths.opencode, "demo.md"), "utf8");
    expect(written).toContain("description: Use to demo");
    expect(written).toContain("model: anthropic/claude-sonnet-4-5");
    expect(written).toMatch(/^---\n[\s\S]+\n---\n[\s\S]*BODY/);
  });

  test("frontmatter keys are emitted in alphabetical order", async () => {
    const r: RenderedAgent = {
      target: "opencode",
      format: "markdown-frontmatter",
      relativePath: "x.md",
      frontmatter: { z: 1, a: 2, m: 3 },
      body: "B",
    };
    await installRendered([r], paths, { homeDir });
    const written = await readFile(join(paths.opencode, "x.md"), "utf8");
    const fmBlock = written.split("---")[1] ?? "";
    const keys = fmBlock
      .split("\n")
      .map((l) => l.split(":")[0]?.trim())
      .filter((k): k is string => !!k);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  test("codex install creates a per-agent subdirectory", async () => {
    const codex: RenderedAgent = {
      target: "codex",
      format: "markdown-frontmatter",
      // Translator now owns the path shape end-to-end (the installer's old
      // codex special-case has been removed in this commit).
      relativePath: "demo/SKILL.md",
      frontmatter: { name: "demo", description: "Use to demo" },
      body: "B",
    };
    await installRendered([codex], paths, { homeDir });
    const written = await readFile(join(paths.codex, "demo", "SKILL.md"), "utf8");
    expect(written).toContain("name: demo");
  });

  test("first occurrence wins on (target, relativePath) conflict; warning emitted", async () => {
    // Caller is responsible for passing the list in precedence order.
    // The orchestrator (Task 14) will sort: project > user-global > registered.
    const fromProject: RenderedAgent = { ...sample, body: "PROJECT_BODY" };
    const fromUser: RenderedAgent = { ...sample, body: "USER_BODY" };
    const result = await installRendered([fromProject, fromUser], paths, { homeDir });
    expect(result.warnings.length).toBeGreaterThan(0);
    const written = await readFile(join(paths.opencode, "demo.md"), "utf8");
    expect(written).toContain("PROJECT_BODY"); // first wins
    expect(written).not.toContain("USER_BODY");
  });

  test("dedup warning identifies the kept bundle when bundlePath is set", async () => {
    const fromProject: RenderedAgent = {
      ...sample,
      body: "PROJECT_BODY",
      bundlePath: "/path/to/project/bundle",
    };
    const fromUser: RenderedAgent = {
      ...sample,
      body: "USER_BODY",
      bundlePath: "/path/to/user/bundle",
    };
    const result = await installRendered([fromProject, fromUser], paths, { homeDir });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("kept: /path/to/project/bundle");
    expect(result.warnings[0]).not.toContain("/path/to/user/bundle");
  });

  test("byte-identical re-install is reported as skipped, not installed", async () => {
    // First write — counts as installed.
    const first = await installRendered([sample], paths, { homeDir });
    expect(first.installed).toHaveLength(1);
    expect(first.skipped).toEqual([]);

    // Second write of the exact same rendered output. The on-disk bytes
    // already match, so the installer must skip the write and report it
    // via `skipped[]` instead of `installed[]`. This lets the CLI summary
    // truthfully say "0 installed, 1 unchanged".
    const second = await installRendered([sample], paths, { homeDir });
    expect(second.installed).toEqual([]);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]?.target).toBe("opencode");
    expect(second.skipped[0]?.path).toBe(join(paths.opencode, "demo.md"));
  });

  test("non-identical re-install rewrites the file and reports it as installed", async () => {
    await installRendered([sample], paths, { homeDir });
    const changed: RenderedAgent = { ...sample, body: "CHANGED_BODY" };
    const result = await installRendered([changed], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    const written = await readFile(join(paths.opencode, "demo.md"), "utf8");
    expect(written).toContain("CHANGED_BODY");
  });
});

describe("io/installer manifest behavior", () => {
  test("first install writes file AND records manifest entry", async () => {
    const result = await installRendered([sample], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed).toHaveLength(1);
    const entry = manifest.installed[0];
    expect(entry?.name).toBe("demo");
    expect(entry?.platform).toBe("opencode");
    expect(entry?.path).toBe(join(paths.opencode, "demo.md"));
    expect(entry?.contentHash).toMatch(/^sha256:[a-f0-9]+$/);
  });

  test("idempotent reinstall: manifest entry preserved with same hash", async () => {
    await installRendered([sample], paths, { homeDir });
    const before = await loadInstalledAgents({ homeDir });
    const beforeHash = before.installed[0]?.contentHash;

    const result = await installRendered([sample], paths, { homeDir });
    expect(result.installed).toEqual([]);
    expect(result.skipped).toHaveLength(1);

    const after = await loadInstalledAgents({ homeDir });
    expect(after.installed[0]?.contentHash).toBe(beforeHash!);
  });

  test("foreign file at destPath: refuses with would-clobber error", async () => {
    const dest = join(paths.opencode, "demo.md");
    mkdirSync(paths.opencode, { recursive: true });
    writeFileSync(dest, "---\nname: foreign\n---\nNot from smith\n");

    await expect(installRendered([sample], paths, { homeDir })).rejects.toThrow(
      /already.exists|would.clobber|not managed by smith/i,
    );
    // File preserved
    const onDisk = await readFile(dest, "utf8");
    expect(onDisk).toContain("Not from smith");
    // No manifest entry
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed).toHaveLength(0);
  });

  test("foreign file at destPath with --force: overwrites and claims", async () => {
    const dest = join(paths.opencode, "demo.md");
    mkdirSync(paths.opencode, { recursive: true });
    writeFileSync(dest, "---\nname: foreign\n---\nNot from smith\n");

    const result = await installRendered([sample], paths, { homeDir, force: true });
    expect(result.installed).toHaveLength(1);
    const onDisk = await readFile(dest, "utf8");
    expect(onDisk).toContain("description: Use to demo"); // smith's render won
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "demo")).toBeDefined();
  });

  test("lazy-claim: pre-existing file with byte-identical content is silently claimed", async () => {
    // First, install once to capture exact serialized output, then reset manifest.
    await installRendered([sample], paths, { homeDir });
    const dest = join(paths.opencode, "demo.md");
    const expectedContent = await readFile(dest, "utf8");
    // Wipe manifest only — file stays in place. Simulates upgrade case where
    // smith's manifest schema didn't exist when the file was first installed.
    rmSync(join(homeDir, ".config/agent-smith/installed-agents.json"), { force: true });

    // File still on disk; reinstall should hash-match → silent claim.
    const result = await installRendered([sample], paths, { homeDir });
    expect(result.installed).toEqual([]);
    expect(result.skipped).toHaveLength(1); // CLAIMED, reported as skipped to user
    const manifest = await loadInstalledAgents({ homeDir });
    expect(manifest.installed.find((e) => e.name === "demo")).toBeDefined();
    // Sanity: file content unchanged
    expect(await readFile(dest, "utf8")).toBe(expectedContent);
  });

  test("manifest path mismatch: refuses without --force", async () => {
    // Realistic scenario: user relocated their install root (e.g. set a
    // different XDG_CONFIG_HOME), so the manifest's recorded path no
    // longer matches what `targetPath()` would compute for the same
    // bundle name + platform. We simulate this by hand-writing a manifest
    // entry whose path points to an old location.
    await installRendered([sample], paths, { homeDir });
    const oldPath = join("/some/old/location", "demo.md");
    const manifestPath = join(homeDir, ".config/agent-smith/installed-agents.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.installed[0].path = oldPath; // simulate stale entry
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(installRendered([sample], paths, { homeDir })).rejects.toThrow(
      /already.exists|manifest path mismatch/i,
    );
  });

  test("manifest path mismatch with --force: re-claims at new path", async () => {
    await installRendered([sample], paths, { homeDir });
    const oldPath = join("/some/old/location", "demo.md");
    const manifestPath = join(homeDir, ".config/agent-smith/installed-agents.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.installed[0].path = oldPath;
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await installRendered([sample], paths, { homeDir, force: true });
    // Either installed (overwrite) or skipped (lazy-claim on hash-match) is
    // acceptable — both prove the path mismatch was resolved. We just need
    // one of the two buckets to have the new path AND the manifest to be
    // updated.
    const total = result.installed.length + result.skipped.length;
    expect(total).toBe(1);
    const after = await loadInstalledAgents({ homeDir });
    const entry = after.installed.find((e) => e.name === "demo");
    expect(entry?.path).toBe(join(paths.opencode, "demo.md")); // re-claimed at new path
  });

  test("owned file modified externally: warning surfaced, install proceeds", async () => {
    await installRendered([sample], paths, { homeDir });
    const dest = join(paths.opencode, "demo.md");
    // Simulate external edit (e.g. user hand-edited or another tool touched it)
    await writeFile(dest, "modified externally\n");

    const result = await installRendered([sample], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
    expect(result.warnings.some((w) => /modified externally/i.test(w))).toBe(true);
    // Smith's render won
    const onDisk = await readFile(dest, "utf8");
    expect(onDisk).toContain("description: Use to demo");
  });
});

describe("io/installer sidecar emission", () => {
  test("writes both main file and sidecar; manifest tracks each independently", async () => {
    const codex: RenderedAgent = {
      target: "codex",
      format: "markdown-frontmatter",
      relativePath: "demo/SKILL.md",
      frontmatter: { name: "demo", description: "Use to demo" },
      body: "BODY",
      sidecars: [
        {
          relativePath: "demo/agents/openai.yaml",
          content: "dependencies:\n  tools:\n    - type: mcp\n      value: foo\n",
        },
      ],
    };
    const result = await installRendered([codex], paths, { homeDir });
    expect(result.installed.length).toBeGreaterThanOrEqual(1);

    // Main file written
    const mainPath = join(paths.codex, "demo", "SKILL.md");
    expect(await readFile(mainPath, "utf8")).toContain("name: demo");

    // Sidecar written verbatim
    const sidecarPath = join(paths.codex, "demo", "agents", "openai.yaml");
    expect(await readFile(sidecarPath, "utf8")).toContain("value: foo");

    // Manifest carries TWO entries with the same (name, platform) pair —
    // one main, one sidecar — distinguished by `kind` and `path`.
    const manifest = await loadInstalledAgents({ homeDir });
    const entries = manifest.installed.filter(
      (e) => e.name === "demo" && e.platform === "codex",
    );
    expect(entries).toHaveLength(2);
    const main = entries.find((e) => e.kind === "main");
    const sc = entries.find((e) => e.kind === "sidecar");
    expect(main?.path).toBe(mainPath);
    expect(sc?.path).toBe(sidecarPath);
    expect(main?.contentHash).toMatch(/^sha256:/);
    expect(sc?.contentHash).toMatch(/^sha256:/);
  });

  test("absent sidecars field: byte-identical to non-sidecar render (no extra writes, no extra entries)", async () => {
    const codex: RenderedAgent = {
      target: "codex",
      format: "markdown-frontmatter",
      relativePath: "demo/SKILL.md",
      frontmatter: { name: "demo", description: "Use to demo" },
      body: "BODY",
    };
    await installRendered([codex], paths, { homeDir });
    const manifest = await loadInstalledAgents({ homeDir });
    const entries = manifest.installed.filter(
      (e) => e.name === "demo" && e.platform === "codex",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("main");
    // Sidecar dir was NOT created.
    const sidecarDir = join(paths.codex, "demo", "agents");
    await expect(readFile(join(sidecarDir, "openai.yaml"), "utf8")).rejects.toThrow();
  });
});
