import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import type { PlatformId } from "../../src/io/platform-detect";

/**
 * Hermetic platform detector for CLI tests. Returns all three platform IDs
 * regardless of what's on the host PATH so the CLI tests assert behavior
 * that is independent of the developer's local toolchain. Tests that
 * specifically exercise platform filtering inject their own set.
 */
const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "smith-doctor-"));
});

afterEach(async () => {
  // Bun auto-cleans tmp; nothing to do.
});

describe("runDoctorCli", () => {
  test("--offline emits human-readable output and exits 0", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      // skipModelResolution: avoids env-dependent staleness from the live
      // opencode binary's model list drifting against the curated fallback.
      // The exit-code-is-0 assertion is what we're guarding here, not the
      // model-resolution section's content (covered by dedicated tests
      // below).
      skipModelResolution: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("OpenCode");
    expect(stdout).toContain("offline");
    expect(stdout).toContain("Claude Code");
    expect(stdout).toContain("Codex");
  });

  test("--offline --json emits parseable JSON with all four platforms", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: true,
      // skipModelResolution: see note in the prior test.
      skipModelResolution: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += s;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      platforms: { platform: string }[];
      exitCode: number;
    };
    expect(parsed.exitCode).toBe(0);
    expect(parsed.platforms.map((p) => p.platform).sort()).toEqual([
      "claude-code",
      "codex",
      "kiro",
      "opencode",
    ]);
  });

  test("fresh cache hit: no fetch is made and cache file is untouched", async () => {
    const cachePath = join(tmpDir, "cache.json");
    const vendored = JSON.parse(
      await readFile(join(import.meta.dir, "../../data/opencode.config.schema.json"), "utf8"),
    );
    const seededAt = new Date().toISOString();
    await writeFile(
      cachePath,
      JSON.stringify({ fetchedAt: seededAt, schema: vendored }),
    );

    let fetchCalled = false;
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: false,
      noCache: false,
      json: true,
      // skipModelResolution: this test guards cache behavior (no fetch +
      // unchanged cache file). Live model resolution is unrelated and would
      // contaminate the exit code on env drift.
      skipModelResolution: true,
      cachePath,
      print: () => {},
      fetch: async () => {
        fetchCalled = true;
        throw new Error("test should not fetch on a fresh cache hit");
      },
    });

    expect(code).toBe(0);
    expect(fetchCalled).toBe(false);
    // Cache file unchanged: same fetchedAt and same schema.
    const after = JSON.parse(await readFile(cachePath, "utf8")) as {
      fetchedAt: string;
      schema: Record<string, unknown>;
    };
    expect(after.fetchedAt).toBe(seededAt);
    expect(after.schema).toEqual(vendored);
  });

  test("--no-cache: fetch is called even when fresh cache exists", async () => {
    const cachePath = join(tmpDir, "cache.json");
    const vendored = JSON.parse(
      await readFile(join(import.meta.dir, "../../data/opencode.config.schema.json"), "utf8"),
    );
    await writeFile(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), schema: vendored }),
    );

    let fetchCalled = false;
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: false,
      noCache: true,
      json: true,
      cachePath,
      print: () => {},
      fetch: async () => {
        fetchCalled = true;
        return new Response(JSON.stringify(vendored), { status: 200 });
      },
    });

    expect(fetchCalled).toBe(true);
  });

  test("--skip-model-resolution: JSON report omits modelResolution section", async () => {
    // The model-resolution check is the only thing that calls into
    // getOpenCodeModels and findOpencodeOnPath. With the skip flag set,
    // runDoctor must receive an undefined modelResolution config and the
    // resulting report must not contain that section. This guards against
    // future regressions that route the check through some other code path.
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: true,
      skipModelResolution: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += s;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      exitCode: number;
      modelResolution?: unknown;
    };
    expect(parsed.modelResolution).toBeUndefined();
  });

  test("default (no --skip-model-resolution): JSON report includes modelResolution section", async () => {
    // Counterpart to the skip test: confirms the model-resolution section is
    // present by default (i.e. the skip flag is the only thing that drops it).
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += s;
      },
    });
    const parsed = JSON.parse(stdout) as { modelResolution?: unknown };
    expect(parsed.modelResolution).toBeDefined();
  });

  test("non-JSON non-TTY output still emits formatted report (streaming gated by isTTY)", async () => {
    // In the test env stdout is typically not a TTY, so streaming should be
    // suppressed and the full formatted report still printed exactly as before.
    // This is a smoke test: it confirms the CLI doesn't crash when the new
    // workspace/streaming wiring is in place.
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    let stdout = "";
    try {
      const code = await runDoctorCli({
        detectInstalledPlatforms: allPlatforms,
        offline: true,
        noCache: false,
        json: false,
        // skipModelResolution: this test is a smoke test for the
        // streaming/non-TTY render path — model resolution is unrelated.
        skipModelResolution: true,
        cachePath: join(tmpDir, "cache.json"),
        print: (s: string) => {
          stdout += `${s}\n`;
        },
      });
      expect(code).toBe(0);
      expect(stdout).toContain("OpenCode");
      expect(stdout).toContain("Workspace");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
    }
  });
});

describe("smith doctor — registry hygiene section", () => {
  let dir: string;
  let registryPath: string;
  let skillRegistryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-doctor-hygiene-"));
    registryPath = join(dir, "registry.json");
    skillRegistryPath = join(dir, "skill-catalogs.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("warns about agent catalog with nonexistent rootPath", async () => {
    const missing = join(dir, "missing-source");
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: missing, label: "missing" }],
      }),
    );
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/Registry hygiene/);
    expect(stdout).toMatch(/missing/);
    expect(stdout).toMatch(/does not exist/i);
    expect(stdout).toMatch(/agent catalog/i);
  });

  test("warns about agent catalog with zero bundles", async () => {
    const empty = join(dir, "empty-source");
    await mkdir(empty, { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: empty, label: "empty" }],
      }),
    );
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/empty/);
    expect(stdout).toMatch(/no agent bundles/i);
  });

  test("warns about empty placeholder bundle directories inside an agent catalog", async () => {
    // Common artifact: a `smith agent init` that was aborted, or a manually
    // created subdirectory, leaves an empty <name>/ under the catalog. The
    // CLI silently ignores it (no agent.config.json → no bundle), but the
    // directory is leftover state the user would benefit from knowing about.
    const root = join(dir, "with-empties");
    await mkdir(join(root, "real-bundle"), { recursive: true });
    await writeFile(join(root, "real-bundle/agent.config.json"), "{}");
    await mkdir(join(root, "abandoned-init"), { recursive: true });
    await mkdir(join(root, "another-empty"), { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", rootPath: root, label: "user-global" }],
      }),
    );
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/Registry hygiene/);
    expect(stdout).toMatch(/empty.*director|abandoned-init|another-empty/i);
  });

  test("warns about skill catalog with nonexistent rootPath", async () => {
    const missing = join(dir, "missing-catalog");
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, sources: [] }));
    await writeFile(
      skillRegistryPath,
      JSON.stringify({
        version: 1,
        catalogs: [{ kind: "user-local", rootPath: missing, label: "missing" }],
      }),
    );
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/missing/);
    expect(stdout).toMatch(/does not exist/i);
    expect(stdout).toMatch(/skill catalog/i);
  });

  test("does not flag healthy entries; section header still appears", async () => {
    const good = join(dir, "good-source");
    await mkdir(join(good, "agent-a"), { recursive: true });
    await writeFile(join(good, "agent-a/agent.config.json"), "{}");
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: good, label: "good" }],
      }),
    );
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      verbose: true,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/Registry hygiene/);
    expect(stdout).toMatch(/Status: ok/);
    expect(stdout).not.toMatch(/\[warn\]/);
    expect(stdout).not.toMatch(/\[error\]/);
  });
});

describe("runDoctorCli verbosity flags", () => {
  test("--quiet emits nothing to stdout and preserves exit code", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      skipModelResolution: true,
      quiet: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("--quiet --json still emits JSON envelope", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: true,
      skipModelResolution: true,
      quiet: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.platforms).toBeDefined();
    expect(parsed.skippedPlatforms).toEqual([]);
  });

  test("default mode prints compact summary + footer (no detail block on clean run)", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      skipModelResolution: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("Run `smith doctor --verbose` for full details.");
    expect(stdout).toContain("Run `smith doctor --json` for machine-readable output.");
    expect(stdout).toContain("Run `smith doctor --offline` to skip the live OpenCode fetch.");
    // Detail-block header strings should NOT appear on a clean run.
    expect(stdout).not.toContain("OpenCode:");
    expect(stdout).not.toContain("Claude Code:");
  });

  test("--verbose prints full per-section detail (today's output)", async () => {
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      skipModelResolution: true,
      verbose: true,
      cachePath: join(tmpDir, "cache.json"),
      print: (s: string) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("OpenCode:"); // detail header from formatOpencodeSection
    expect(stdout).toContain("Claude Code:");
    expect(stdout).toContain("Codex:");
    // The 2-line footer (no --verbose hint) — formatReport's footer.
    expect(stdout).toContain("Run `smith doctor --json` for machine-readable output.");
    expect(stdout).toContain("Run `smith doctor --offline` to skip the live OpenCode fetch.");
    expect(stdout).not.toContain("Run `smith doctor --verbose` for full details.");
  });
});

describe("smith doctor — remote catalogs section wiring (DW-4)", () => {
  let dir: string;
  let registryPath: string;
  let skillRegistryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-doctor-remote-"));
    registryPath = join(dir, "registry.json");
    skillRegistryPath = join(dir, "skill-catalogs.json");
    await writeFile(registryPath, JSON.stringify({ version: 1, sources: [] }));
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("JSON report includes remoteCatalogs section (CLI wires input.remoteCatalogs)", async () => {
    // DW-4 regression: src/cli/commands/doctor.ts wasn't passing
    // input.remoteCatalogs to runDoctor, so the C3.14 remote-catalogs
    // section never ran on real CLI invocations even though every
    // catalog had `gitRemote` populated. Asserting the JSON shape
    // exposes the wiring: when the section is gated off, the field
    // is absent; when wired, the field is present (even with empty
    // findings).
    let stdout = "";
    const code = await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: true,
      skipModelResolution: true,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { remoteCatalogs?: unknown };
    expect(parsed.remoteCatalogs).toBeDefined();
  });

  test("--verbose human output shows 'Remote catalogs' section header", async () => {
    let stdout = "";
    await runDoctorCli({
      detectInstalledPlatforms: allPlatforms,
      offline: true,
      noCache: false,
      json: false,
      verbose: true,
      skipModelResolution: true,
      cachePath: join(dir, "cache.json"),
      registryPath,
      skillRegistryPath,
      print: (s) => {
        stdout += `${s}\n`;
      },
    });
    expect(stdout).toMatch(/Remote catalogs/);
  });
});
