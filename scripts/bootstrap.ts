// scripts/bootstrap.ts — installs bundled skills (the-architect,
// the-keymaker) into platform skill directories. As of Batch 20 this
// script no longer installs the agent-smith persona; that responsibility
// moved to bin/install Step 9, smith update Step 4, and `smith agent install
// agent-smith` (all of which use the synthetic agent-smith-self source
// in src/io/registry.ts).
//
// Two invocation modes:
//   - "cli": invoked by `smith skill bootstrap`. Strict: returns non-zero exit
//     code on conflicts; surfaces errors to caller.
//   - "postinstall": invoked by package.json postinstall hook. Fail-soft:
//     never throws, always exits 0, prints one summary line.
//
// Skill install contract:
//   - Bundled skills are COPIED via installSkill (not symlinked) so
//     `smith doctor` can detect drift via content-hash comparison. Re-running
//     is idempotent: existing platform dest dirs are replaced, and the
//     installed-skills.json state file is updated via updateSkill.
//   - Skip silently if a platform skill dir does not exist.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { hashSkillDir, loadInstalledSkills } from "../src/io/installed-skills";
import { installSkill, updateSkill } from "../src/io/skill-installer";

export interface BootstrapPlatforms {
  opencode: string;
  "claude-code": string;
  codex: string;
}

// `BootstrapPlatforms` and `InstallPaths` are structurally identical (same
// three target keys → string). Kept as separate names for call-site clarity:
// one carries SKILL dirs, the other carries AGENT dirs.

export interface BootstrapOptions {
  /** Absolute path to the agent-smith repo root (contains skills/). */
  repoRoot: string;
  /** Per-platform skill directory paths. */
  platforms: BootstrapPlatforms;
  /** Strict (cli) or fail-soft (postinstall). */
  mode: "cli" | "postinstall";
  /** If true, log what would happen without touching the filesystem. */
  dryRun?: boolean;
  /**
   * Override $HOME for installSkill's state file location. Production callers
   * leave this unset (installSkill defaults to os.homedir()); tests pass a
   * tmpdir to keep installed-skills.json hermetic.
   */
  homeDir?: string;
}

export interface BootstrapResult {
  skillsLinked: number;
  skillsSkipped: number;
  bundledSkillsInstalled: number;
  bundledSkillsFailed: number;
  /**
   * Hard errors. Only populated in `mode: "cli"`. In `mode: "postinstall"`,
   * conflicts are downgraded to warnings (postinstall must never fail
   * package installation).
   */
  errors: string[];
  warnings: string[];
}

const BUNDLED_SKILLS = ["the-architect", "the-keymaker"];

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function runPostinstallDaemonRestart(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { openSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  const { join: pjoin } = await import("node:path");
  const { runtimeStateHome } = await import("../src/io/runtime-state-home");
  const { restartDaemonIfStale } = await import("../src/daemon/restart-on-upgrade");

  const stateDir = runtimeStateHome();
  const pidPath = pjoin(stateDir, "daemon.pid");
  const heartbeatPath = pjoin(stateDir, "daemon.heartbeat.json");
  const logPath = pjoin(stateDir, "daemon.log");

  const result = await restartDaemonIfStale({
    log: (line) => console.log(`agent-smith: ${line}`),
    errLog: (line) => console.warn(`agent-smith: ${line}`),
    pidFileExists: async () => {
      try {
        await readFile(pidPath, "utf-8");
        return true;
      } catch {
        return false;
      }
    },
    readPidFile: async () => {
      try {
        return await readFile(pidPath, "utf-8");
      } catch {
        return null;
      }
    },
    readHeartbeat: async () => {
      try {
        const raw = await readFile(heartbeatPath, "utf-8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    killProcess: (pid, signal) => process.kill(pid, signal),
    spawnDetached: () => {
      const entry = process.argv[1];
      if (!entry) return 0;
      // The smith binary's entry-point is the same script that drives `smith daemon start`.
      // Resolve it relative to this script: scripts/bootstrap.ts → ../src/index.ts is the
      // CLI entry. We invoke it via bun for parity with how the user runs it.
      const repoRoot = (() => {
        const here = new URL(import.meta.url).pathname;
        return pjoin(here, "..", "..");
      })();
      const cliEntry = pjoin(repoRoot, "src", "index.ts");
      const fd = openSync(logPath, "a");
      const child = spawn("bun", [cliEntry, "daemon", "start"], {
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
      return child.pid ?? 0;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    recencyGuardMs: 60_000,
    shutdownTimeoutMs: 10_000,
    pollIntervalMs: 250,
    optOut: process.env.SMITH_NO_DAEMON_AUTO_RESTART === "1",
  });

  if (result.action === "restarted") {
    console.log(`agent-smith: daemon restarted (pid ${result.pid})`);
  }
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    skillsLinked: 0,
    skillsSkipped: 0,
    bundledSkillsInstalled: 0,
    bundledSkillsFailed: 0,
    errors: [],
    warnings: [],
  };
  const platformCount = Object.values(opts.platforms).length;

  if (opts.dryRun) {
    // Preview only: count platforms whose dirs exist per bundled skill.
    for (const skillName of BUNDLED_SKILLS) {
      const skillSource = join(opts.repoRoot, "skills", skillName);
      if (!(await pathExists(skillSource))) {
        result.warnings.push(
          `Skill source not found at ${skillSource}; partial clone or non-source install? Skipping skill bootstrap for '${skillName}'.`,
        );
        result.bundledSkillsFailed++;
        continue;
      }
      result.bundledSkillsInstalled++;
      for (const dir of Object.values(opts.platforms)) {
        if (await pathExists(dir)) result.skillsLinked++;
        else result.skillsSkipped++;
      }
    }
  } else {
    // Translate BootstrapPlatforms (kebab-case keys) to PlatformDirs
    // (camelCase keys expected by skill-installer).
    const platformDirs = {
      opencode: opts.platforms.opencode,
      claudeCode: opts.platforms["claude-code"],
      codex: opts.platforms.codex,
    };

    const installed = await loadInstalledSkills(
      opts.homeDir ? { homeDir: opts.homeDir } : undefined,
    );

    for (const skillName of BUNDLED_SKILLS) {
      const skillSource = join(opts.repoRoot, "skills", skillName);
      if (!(await pathExists(skillSource))) {
        result.warnings.push(
          `Skill source not found at ${skillSource}; partial clone or non-source install? Skipping skill bootstrap for '${skillName}'.`,
        );
        result.bundledSkillsFailed++;
        continue;
      }

      const already = installed.installed.some((e) => e.name === skillName);

      // Keep existing the-architect postinstall overwrite warning behavior.
      if (skillName === "the-architect" && opts.mode === "postinstall" && !already) {
        const sourceHash = await hashSkillDir(skillSource).catch(() => null);
        if (sourceHash !== null) {
          for (const dir of Object.values(opts.platforms)) {
            const dest = join(dir, skillName);
            if (!(await pathExists(dest))) continue;
            const destHash = await hashSkillDir(dest).catch(() => null);
            if (destHash !== null && destHash !== sourceHash) {
              result.warnings.push(
                `Existing the-architect at ${dest} differs from the bundled source; replacing it (back up first if you have local edits).`,
              );
            }
          }
        }
      }

      const verb = already ? updateSkill : installSkill;
      const r = await verb(skillName, {
        platformDirs,
        ...(opts.homeDir ? { homeDir: opts.homeDir } : {}),
        sourceOverride: { sourceDir: skillSource, sourceCatalogLabel: "bundled" },
      });

      if (r.ok) {
        const writtenCount = Object.values(r.installed.installedPaths).filter(
          (v) => typeof v === "string",
        ).length;
        result.skillsLinked += writtenCount;
        result.skillsSkipped += platformCount - writtenCount;
        if (writtenCount > 0) result.bundledSkillsInstalled++;
      } else {
        result.bundledSkillsFailed++;
        if (opts.mode === "cli") result.errors.push(r.error);
        else result.warnings.push(r.error);
      }
    }
  }

  return result;
}

// CLI entry point. Invoked by package.json postinstall script as:
//   bun run scripts/bootstrap.ts --mode=postinstall
// Or directly by `smith skill bootstrap` through the wrapper at
// src/cli/commands/skill/bootstrap.ts (which imports the bootstrap()
// function instead of going through this entry point).
if (import.meta.main) {
  const args = process.argv.slice(2);
  const mode: "cli" | "postinstall" = args.includes("--mode=postinstall") ? "postinstall" : "cli";

  if (mode === "postinstall") {
    if (process.env.AGENT_SMITH_SKIP_POSTINSTALL === "1") {
      console.log("agent-smith: postinstall skipped (AGENT_SMITH_SKIP_POSTINSTALL=1)");
      process.exit(0);
    }
    if (process.env.CI === "true") {
      console.log("agent-smith: postinstall skipped (CI=true)");
      process.exit(0);
    }
  }

  // Resolve repo root from this script's location: scripts/bootstrap.ts
  // is one directory below the repo root.
  const { homedir } = await import("node:os");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const platforms = {
    opencode: join(homedir(), ".config/opencode/skills"),
    "claude-code": join(homedir(), ".claude/skills"),
    // Codex skills and agents share `~/.agents/skills/` per Codex spec
    // (https://developers.openai.com/codex/skills). Both are
    // directory-with-SKILL.md shaped; collisions only occur if a skill and
    // agent share a name.
    codex: join(homedir(), ".agents/skills"),
  };

  try {
    const result = await bootstrap({ repoRoot, platforms, mode });
    if (mode === "postinstall") {
      console.log(
        `agent-smith: bootstrap complete (Installed ${result.bundledSkillsInstalled} bundled skills, ${result.skillsLinked} skills linked${result.warnings.length > 0 ? `, ${result.warnings.length} warnings` : ""})`,
      );
      for (const w of result.warnings) console.warn(`  warning: ${w}`);
      try {
        await runPostinstallDaemonRestart();
      } catch (err) {
        // Fail-soft: never break `bun install` because of daemon orchestration.
        console.warn(
          `agent-smith: daemon restart skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Postinstall ALWAYS exits 0 — never break `bun install`.
      process.exit(0);
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) console.error(`error: ${e}`);
      process.exit(1);
    }
    console.log(
      `Bootstrap complete: Installed ${result.bundledSkillsInstalled} bundled skills, ${result.skillsLinked} skills linked.`,
    );
    process.exit(0);
  } catch (err) {
    if (mode === "postinstall") {
      console.warn(`agent-smith: postinstall failed silently: ${(err as Error).message}`);
      process.exit(0);
    }
    throw err;
  }
}
