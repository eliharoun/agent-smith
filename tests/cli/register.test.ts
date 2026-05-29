import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { register } from "../../src/cli/commands/register";
import { SmithError } from "../../src/core/smith-error";

describe("smith agent register — validation", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-register-test-"));
    registryPath = join(dir, "registry.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("rejects nonexistent path", async () => {
    const missing = join(dir, "nope");
    const err = await register(missing, { kind: "registered", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("agent catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("does not exist"))).toBe(true);
  });

  test("rejects path that looks like a skill catalog and points at smith skill register", async () => {
    const target = join(dir, "skills");
    await mkdir(join(target, "skill-a"), { recursive: true });
    await writeFile(join(target, "skill-a/SKILL.md"), "# x");
    const err = await register(target, { kind: "registered", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("agent catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("smith skill register"))).toBe(true);
    expect(err.payload.suggestedCommand).toContain("smith skill register");
  });

  test("rejects empty path without --allow-empty", async () => {
    const target = join(dir, "empty");
    await mkdir(target, { recursive: true });
    const err = await register(target, { kind: "registered", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("agent catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("no agent bundles"))).toBe(true);
    expect(err.payload.suggestedCommand).toContain("--allow-empty");
  });

  // The "no agent bundles" error is also what users hit when they try to
  // register a single bundle directory (e.g. `smith agent register .../agents/my-debugger`)
  // — `register` expects a CATALOG (dir-of-dirs), and a bundle dir contains
  // agent.config.json directly, not a child dir with one. The error must
  // mention this confusion so the user understands `register` operates on
  // catalogs, and that bundles inside an already-registered root are
  // auto-discovered (no per-bundle register needed).
  test("rejects a single bundle dir with hint about auto-discovery + parent dir", async () => {
    const bundleDir = join(dir, "my-debugger");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "agent.config.json"), "{}");
    const err = await register(bundleDir, { kind: "user-global", registryPath }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    const reasons: string[] = err.payload.reasons;
    expect(reasons.some((r) => r.toLowerCase().includes("auto-discovered"))).toBe(true);
    expect(reasons.some((r) => r.toLowerCase().includes("parent"))).toBe(true);
  });

  test("accepts empty path with --allow-empty", async () => {
    const target = join(dir, "empty");
    await mkdir(target, { recursive: true });
    await register(target, { kind: "registered", registryPath, allowEmpty: true });
    // No throw is the assertion.
    expect(true).toBe(true);
  });

  test("accepts path with at least one agent bundle", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");
    await register(target, { kind: "registered", registryPath });
    expect(true).toBe(true);
  });

  test("--git-remote URL mismatch is rejected", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");
    const fakeRunGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/fake";
      if (args[0] === "remote") return "origin\thttps://example.com/other.git (fetch)";
      throw new Error("unreachable");
    };
    const err = await register(target, {
      kind: "registered",
      registryPath,
      gitRemote: "https://example.com/foo.git",
      runGit: fakeRunGit,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("agent catalog");
    expect(err.payload.reasons.some((r: string) => r.includes("does not match any remote"))).toBe(
      true,
    );
  });

  test("--skip-git-check bypasses git validation", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");
    await register(target, {
      kind: "registered",
      registryPath,
      gitRemote: "https://example.com/foo.git",
      skipGitCheck: true,
    });
    expect(true).toBe(true);
  });

  test("second register of same path with different label warns and keeps original label", async () => {
    const target = join(dir, "agents");
    await mkdir(join(target, "agent-a"), { recursive: true });
    await writeFile(join(target, "agent-a/agent.config.json"), "{}");

    // First register — succeeds, label "original".
    await register(target, { kind: "registered", registryPath, label: "original" });

    // Second register, same path, different label — must warn and keep
    // the original label in the persisted registry.
    const stderrSpy: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      stderrSpy.push(args.map((a) => String(a)).join(" "));
    };
    try {
      await register(target, { kind: "registered", registryPath, label: "different" });
    } finally {
      console.error = origErr;
    }
    expect(stderrSpy.some((line) => line.includes("already registered"))).toBe(true);
    expect(stderrSpy.some((line) => line.includes("smith agent catalog rename"))).toBe(true);
    expect(stderrSpy.some((line) => line.includes("--label"))).toBe(true);

    const reg = JSON.parse(await readFile(registryPath, "utf8"));
    const entry = reg.sources.find(
      (s: { rootPath: string }) => s.rootPath === target,
    );
    expect(entry.label).toBe("original");
  });
});
