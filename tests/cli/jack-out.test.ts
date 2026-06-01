import { describe, expect, test } from "bun:test";
import { runJackOutCli } from "../../src/cli/commands/jack-out";
import { EXIT_RUNTIME } from "../../src/cli/exit-codes";
import type { InstallPaths, Target } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
  "agents-md": "/fake/agents-md/agents",
};

const FAKE_CONFIG = "/fake/config/agent-smith";
const OWNED_ROOT = `${FAKE_CONFIG}/agents`;
const ownedBundle = (name: string, targets: Target[]) =>
  fakeBundle(name, { targets, rootPath: OWNED_ROOT });

describe("cli/jack-out runJackOutCli", () => {
  test("plan output includes all removal sections", async () => {
    const printed: string[] = [];
    await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      dryRun: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [ownedBundle("foo", ["opencode"])], failures: [] }),
      print: (m) => printed.push(m),
      statFile: async () => {},
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
    });
    const all = printed.join("\n");
    expect(all).toContain("Installed agents");
    expect(all).toContain("/fake/opencode/agents/foo.md");
    expect(all).toContain("Smith config");
    expect(all).toContain("/fake/config/agent-smith");
    expect(all).toContain("Runtime state files");
    expect(all).toContain("is NOT removed");
    expect(all).toContain("Smith CLI symlink");
    expect(all).toContain("Smith source clone");
    expect(all).toContain("Shell PATH wiring");
    expect(all).not.toContain("After this command finishes, run:");
    expect(all).not.toContain("bun unlink");
    expect(all).not.toContain("~/.bun/bin/smith");
  });

  test("dry-run prints the plan once and ends with the dry-run banner", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      dryRun: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [ownedBundle("foo", ["opencode"])], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
    });
    expect(code).toBe(0);
    expect(printed.filter((m) => m === "This will permanently remove:")).toHaveLength(1);
    expect(printed[printed.length - 1]).toContain("DRY RUN");
  });

  test("token decline: anything other than literal 'jack-out' → exit 1, no changes", async () => {
    for (const declined of ["n", "yes", "Jack-Out", "JACK-OUT", "jackout", ""]) {
      let rmCalled = false;
      let rmDirCalled = false;
      const printed: string[] = [];
      const code = await runJackOutCli({
        paths,
        configDir: "/fake/config/agent-smith",
        statFile: async () => {},
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [ownedBundle("foo", ["opencode"])], failures: [] }),
        print: (m) => printed.push(m),
        readToken: async () => declined,
        rmFile: async () => {
          rmCalled = true;
        },
        rmDir: async () => {
          rmDirCalled = true;
        },
      });
      expect(code, `declined=${JSON.stringify(declined)}`).toBe(EXIT_RUNTIME);
      expect(rmCalled, `declined=${JSON.stringify(declined)}`).toBe(false);
      expect(rmDirCalled, `declined=${JSON.stringify(declined)}`).toBe(false);
      expect(printed[printed.length - 1]).toBe("Aborted. No changes made.");
    }
  });

  test("token accepted: literal 'jack-out' runs uninstall + rmDir + new removals", async () => {
    const printed: string[] = [];
    const destroyCalls: string[] = [];
    let rmDirCalled = "";
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [ownedBundle("foo", ["opencode"]), ownedBundle("bar", ["claude-code"])],
        failures: [],
      }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async (opts) => {
        destroyCalls.push(opts.name);
        return 0;
      },
      rmFile: async () => {},
      rmDir: async (p) => {
        if (p === "/fake/config/agent-smith") rmDirCalled = p;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(destroyCalls).toEqual(["foo", "bar"]);
    expect(rmDirCalled).toBe("/fake/config/agent-smith");
    // No "After this command finishes" trailing block.
    expect(printed.some((m) => m === "After this command finishes, run:")).toBe(false);
  });

  test("--yes skips the token prompt", async () => {
    let promptCalled = false;
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: () => {},
      readToken: async () => {
        promptCalled = true;
        return "jack-out";
      },
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(promptCalled).toBe(false);
  });

  test("--dry-run prints the plan, skips prompt, skips both rmFile and rmDir", async () => {
    let promptCalled = false;
    let rmCalled = false;
    let rmDirCalled = false;
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      dryRun: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [ownedBundle("foo", ["opencode"])], failures: [] }),
      print: () => {},
      readToken: async () => {
        promptCalled = true;
        return "jack-out";
      },
      runDestroyAgent: async () => {
        rmCalled = true;
        return 0;
      },
      rmFile: async () => {
        rmCalled = true;
      },
      rmDir: async () => {
        rmDirCalled = true;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(promptCalled).toBe(false);
    expect(rmCalled).toBe(false);
    expect(rmDirCalled).toBe(false);
  });

  test("rmDir failure on config → exit 3", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async (p) => {
        if (p === "/fake/config/agent-smith") {
          throw new Error("EACCES: permission denied");
        }
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(3);
    const failedLines = printed.filter(
      (m) => m.includes("✗ failed:") && m.includes("/fake/config/agent-smith"),
    );
    expect(failedLines).toHaveLength(1);
    expect(failedLines[0]).toContain("permission denied");
  });

  test("rmDir ENOENT on config → categorized as not-found, exit 0", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    // Postcondition (config dir does not exist) is already satisfied → exit 0.
    expect(code).toBe(0);
    const notFoundConfig = printed.filter((m) =>
      m.includes("- not found: /fake/config/agent-smith"),
    );
    expect(notFoundConfig).toHaveLength(1);
    // No "failed:" line should be printed for ENOENT.
    expect(printed.some((m) => m.includes("✗ failed:"))).toBe(false);
  });

  test("destroy-agent failure + config success → exit 3, config still removed", async () => {
    let rmDirCalled = "";
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [ownedBundle("foo", ["opencode"])], failures: [] }),
      print: () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 2,
      rmFile: async () => {},
      rmDir: async (p) => {
        if (p === "/fake/config/agent-smith") rmDirCalled = p;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(3);
    expect(rmDirCalled).toBe("/fake/config/agent-smith");
  });

  test("warns load failures and continues with cleanup", async () => {
    const printed: string[] = [];
    const destroyCalls: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [ownedBundle("good", ["opencode"])],
        failures: [
          {
            sourceKind: "user-global",
            sourceLabel: "user",
            bundlePath: "/fake/bad",
            reason: "schema bork",
          },
        ],
      }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async (opts) => {
        destroyCalls.push(opts.name);
        return 0;
      },
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    // Warning printed for the bad bundle.
    expect(
      printed.some((m) => /warn:/.test(m) && /\/fake\/bad/.test(m) && /schema bork/.test(m)),
    ).toBe(true);
    // Plan + cleanup proceeded for the good bundle.
    expect(destroyCalls).toEqual(["good"]);
    // Plan listed the good bundle's path.
    expect(printed.some((m) => /\/fake\/opencode\/agents\/good\.md/.test(m))).toBe(true);
  });

  test("ownership filter: skips bundles outside configDir; shows them in 'Skipped' section", async () => {
    const printed: string[] = [];
    const destroyCalls: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: FAKE_CONFIG,
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          ownedBundle("owned-agent", ["opencode"]),
          fakeBundle("external-agent", {
            targets: ["opencode"],
            rootPath: "/fake/elsewhere/external",
          }),
        ],
        failures: [],
      }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async (opts) => {
        destroyCalls.push(opts.name);
        return 0;
      },
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(destroyCalls).toEqual(["owned-agent"]);
    const all = printed.join("\n");
    expect(all).toContain("Skipped — not managed by agent-smith");
    expect(all).toContain("external-agent");
    expect(all).toContain("/fake/elsewhere/external");
  });

  test("ownership filter: kind=registered (even inside configDir) is skipped", async () => {
    const destroyCalls: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: FAKE_CONFIG,
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("registered-agent", {
            targets: ["opencode"],
            kind: "registered",
            rootPath: `${FAKE_CONFIG}/agents`,
          }),
        ],
        failures: [],
      }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async (opts) => {
        destroyCalls.push(opts.name);
        return 0;
      },
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(destroyCalls).toEqual([]);
  });

  test("skill removal: calls uninstallSkill for each installed skill; reports success", async () => {
    const printed: string[] = [];
    const removed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: FAKE_CONFIG,
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({
        schemaVersion: 1,
        installed: [
          {
            name: "skill-a",
            sourceCatalogLabel: "test",
            sourcePath: "/src/a",
            installedPaths: { opencode: "/fake/opencode/skills/skill-a" },
            contentHash: "h1",
            installedAt: "2026-01-01T00:00:00Z",
          },
          {
            name: "skill-b",
            sourceCatalogLabel: "test",
            sourcePath: "/src/b",
            installedPaths: { codex: "/fake/agents/skills/skill-b" },
            contentHash: "h2",
            installedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      uninstallSkill: async (name) => {
        removed.push(name);
        return { ok: true };
      },
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(removed).toEqual(["skill-a", "skill-b"]);
    const all = printed.join("\n");
    expect(all).toContain("Installed skills (2 skills");
    expect(all).toContain("✓ removed skill: skill-a");
    expect(all).toContain("✓ removed skill: skill-b");
  });

  test("skill removal failure → exit 3, but later steps still run", async () => {
    let rmDirCalled = "";
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: FAKE_CONFIG,
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({
        schemaVersion: 1,
        installed: [
          {
            name: "broken-skill",
            sourceCatalogLabel: "test",
            sourcePath: "/src/x",
            installedPaths: { opencode: "/fake/opencode/skills/broken-skill" },
            contentHash: "h",
            installedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      uninstallSkill: async () => ({ ok: false, error: "EACCES" }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async (p) => {
        if (p === FAKE_CONFIG) rmDirCalled = p;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(3);
    expect(rmDirCalled).toBe(FAKE_CONFIG);
    expect(printed.some((m) => m.includes("✗ failed skill: broken-skill"))).toBe(true);
  });

  test("plan output: empty installed-skills shows '(none recorded ...)'", async () => {
    const printed: string[] = [];
    await runJackOutCli({
      paths,
      configDir: FAKE_CONFIG,
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      dryRun: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    const all = printed.join("\n");
    expect(all).toContain("Installed skills (0 skills");
    expect(all).toContain("(none recorded in installed-skills.json)");
  });

  test("delegates per-bundle to runDestroyAgent and runs new removals", async () => {
    const printed: string[] = [];
    const destroyCalls: { name: string; yes: boolean | undefined; force: boolean | undefined }[] =
      [];
    const rmFileCalls: string[] = [];
    const rmDirCalls: string[] = [];
    const writeRcCalls: { path: string; content: string }[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("foo", { targets: ["opencode"], rootPath: "/fake/config/agent-smith/agents" }),
          fakeBundle("extra-x", { targets: ["opencode"], rootPath: "/fake/skills" }),
        ],
        failures: [],
      }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async (opts) => {
        destroyCalls.push({ name: opts.name, yes: opts.yes, force: opts.force });
        return 0;
      },
      rmFile: async (p) => {
        rmFileCalls.push(p);
      },
      rmDir: async (p) => {
        rmDirCalls.push(p);
      },
      readRcFile: async () =>
        '# preamble\n\n# >>> agent-smith installer >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< agent-smith installer <<<\n# postamble\n',
      writeRcFile: async (p, c) => {
        writeRcCalls.push({ path: p, content: c });
      },
    });
    expect(code).toBe(0);
    expect(destroyCalls).toEqual([{ name: "foo", yes: true, force: true }]);
    expect(rmFileCalls).toContain("/fake/.local/bin/smith");
    expect(rmDirCalls).toContain("/fake/config/agent-smith");
    expect(rmDirCalls).toContain("/fake/.agent-smith");
    expect(writeRcCalls).toHaveLength(1);
    expect(writeRcCalls[0]?.content).not.toContain("agent-smith installer");
    expect(writeRcCalls[0]?.content).toContain("# preamble");
    expect(writeRcCalls[0]?.content).toContain("# postamble");
  });

  test("delegation failure aggregates into EXIT_PARTIAL", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("broken", {
            targets: ["opencode"],
            rootPath: "/fake/config/agent-smith/agents",
          }),
        ],
        failures: [],
      }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 2,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(3);
    expect(printed.join("\n")).toContain("agent destroy failed for: broken");
  });

  test("delegation throw aggregates into EXIT_PARTIAL (e.g. SmithError from destroy-agent)", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("broken", {
            targets: ["opencode"],
            rootPath: "/fake/config/agent-smith/agents",
          }),
        ],
        failures: [],
      }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => {
        throw new Error("simulated SmithError");
      },
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(3);
    expect(printed.join("\n")).toContain("agent destroy failed for: broken");
    expect(printed.join("\n")).toContain("simulated SmithError");
  });

  test("idempotent: missing rc marker block is logged and continues", async () => {
    const printed: string[] = [];
    let writeRcCalled = false;
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => "# no agent-smith block here\n",
      writeRcFile: async () => {
        writeRcCalled = true;
      },
    });
    expect(code).toBe(0);
    expect(writeRcCalled).toBe(false);
    expect(printed.join("\n")).toContain("PATH wiring not found");
  });

  test("idempotent: missing rc file (ENOENT) is logged and continues", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () => {
        const e = new Error("ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(printed.join("\n")).toContain("PATH wiring not found");
  });

  test("idempotent: missing symlink (ENOENT on rmFile) is treated as success", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async (p) => {
        if (p === "/fake/.local/bin/smith") {
          const e = new Error("ENOENT") as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        }
      },
      rmDir: async () => {},
      readRcFile: async () => "",
      writeRcFile: async () => {},
    });
    expect(code).toBe(0);
    expect(printed.join("\n")).toContain("not found: /fake/.local/bin/smith");
  });

  test("user-edited content INSIDE the marker block is removed with the block", async () => {
    const writeRcCalls: { path: string; content: string }[] = [];
    await runJackOutCli({
      paths,
      configDir: "/fake/config",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
      rmFile: async () => {},
      rmDir: async () => {},
      readRcFile: async () =>
        "before\n# >>> agent-smith installer >>>\nexport PATH=...\nuser_edit_inside_block=1\n# <<< agent-smith installer <<<\nafter\n",
      writeRcFile: async (p, c) => {
        writeRcCalls.push({ path: p, content: c });
      },
    });
    expect(writeRcCalls).toHaveLength(1);
    expect(writeRcCalls[0]?.content).not.toContain("user_edit_inside_block");
    expect(writeRcCalls[0]?.content).toContain("before");
    expect(writeRcCalls[0]?.content).toContain("after");
  });

  test("removes daemon + GUI job history files from runtimeStateDir but preserves remote/", async () => {
    const rmFileCalls: string[] = [];
    const rmDirCalls: string[] = [];
    await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      runtimeStateDir: "/fake/state/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: () => {},
      rmFile: async (p) => {
        rmFileCalls.push(p);
      },
      rmDir: async (p) => {
        rmDirCalls.push(p);
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
    });

    // daemon files + gui-jobs.jsonl get rmFile'd
    expect(rmFileCalls).toContain("/fake/state/agent-smith/daemon.pid");
    expect(rmFileCalls).toContain("/fake/state/agent-smith/daemon.log");
    expect(rmFileCalls).toContain("/fake/state/agent-smith/daemon.heartbeat.json");
    expect(rmFileCalls).toContain("/fake/state/agent-smith/gui-jobs.jsonl");

    // gui-jobs-output/ gets rmDir'd
    expect(rmDirCalls).toContain("/fake/state/agent-smith/gui-jobs-output");

    // remote/ is NOT touched (managed separately by unregister --purge-clone).
    // The runtimeStateDir itself isn't recursively removed either.
    expect(rmFileCalls).not.toContain("/fake/state/agent-smith/remote");
    expect(rmDirCalls).not.toContain("/fake/state/agent-smith/remote");
    expect(rmDirCalls).not.toContain("/fake/state/agent-smith");
  });

  test("ENOENT on runtime state files is logged and continues (idempotent)", async () => {
    const printed: string[] = [];
    const code = await runJackOutCli({
      paths,
      configDir: "/fake/config/agent-smith",
      runtimeStateDir: "/fake/state/agent-smith",
      homeDir: "/fake",
      sourceDir: "/fake/.agent-smith",
      symlinkPath: "/fake/.local/bin/smith",
      shellRcPath: "/fake/.zshrc",
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      loadInstalledSkills: async () => ({ schemaVersion: 1, installed: [] }),
      print: (m) => printed.push(m),
      rmFile: async () => {
        const e = new Error("ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      rmDir: async () => {
        const e = new Error("ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      readRcFile: async () => "",
      writeRcFile: async () => {},
      readToken: async () => "jack-out",
      runDestroyAgent: async () => 0,
    });
    expect(code).toBe(0); // ENOENT is success, not failure
    const all = printed.join("\n");
    expect(all).toContain("not found: /fake/state/agent-smith/daemon.pid");
    expect(all).toContain("not found: /fake/state/agent-smith/gui-jobs-output");
  });
});
