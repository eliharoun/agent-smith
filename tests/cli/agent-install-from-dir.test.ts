import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;
let prevClaudeTier: string | undefined;
let stderr: string;
let prevStderrWrite: typeof process.stderr.write;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "install-from-dir-cli-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
  prevClaudeTier = process.env.SMITH_CLAUDE_TIER_BALANCED;
  process.env.SMITH_CLAUDE_TIER_BALANCED = "sonnet";
  stderr = "";
  prevStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(async () => {
  process.stderr.write = prevStderrWrite;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  if (prevClaudeTier === undefined) delete process.env.SMITH_CLAUDE_TIER_BALANCED;
  else process.env.SMITH_CLAUDE_TIER_BALANCED = prevClaudeTier;
  await rm(home, { recursive: true, force: true });
});

async function seedCatalog(): Promise<string> {
  const catalog = await mkdtemp(join(tmpdir(), "team-agents-"));
  const bundleDir = join(catalog, "code-reviewer");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "code-reviewer",
      description: "Use proactively as a local-dir install fixture.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "subagent",
    }),
  );
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(bundleDir, f), "placeholder\n");
  }
  return catalog;
}

describe("smith agent install --from <local-dir>", () => {
  test(
    "registers the local directory and installs the bundle",
    async () => {
      const catalog = await seedCatalog();
      try {
        await install({
          from: catalog,
          platformFilter: ["claude-code"],
        });
        const regRaw = await readFile(join(home, "agent-smith", "registry.json"), "utf8");
        const reg = JSON.parse(regRaw);
        const entry = reg.sources.find((s: { rootPath: string }) => s.rootPath === catalog);
        expect(entry).toBeDefined();
        expect(entry.kind).toBe("registered");
      } finally {
        await rm(catalog, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test(
    "prints sync-registration hint when the directory is a git repo",
    async () => {
      const catalog = await seedCatalog();
      try {
        await mkdir(join(catalog, ".git"));
        await writeFile(
          join(catalog, ".git", "config"),
          `[remote "origin"]\n\turl = git@github.com:acme/team-agents.git\n`,
        );
        // Force TTY for the hint to print.
        const origIsTTY = process.stderr.isTTY;
        Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
        try {
          await install({
            from: catalog,
            platformFilter: ["claude-code"],
            // Inject printErr so hint output is captured into `stderr` regardless
            // of how console.error is wired in the bun test runner.
            printErr: (m: string) => { stderr += m + "\n"; },
          });
        } finally {
          Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
        }
        expect(stderr).toContain("smith agent register");
        expect(stderr).toContain("git@github.com:acme/team-agents.git");
        expect(stderr).toContain("--git-remote");
      } finally {
        await rm(catalog, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test(
    "records pending ops for skipped (undetected) platforms",
    async () => {
      const catalog = await seedCatalog();
      try {
        // Add a target the test environment doesn't have on PATH.
        // claude-code is detected via SMITH_CLAUDE_TIER_BALANCED in the harness;
        // codex / opencode / kiro are not, so adding any of them surfaces a
        // pending op. Update the bundle to declare a non-detected target:
        const cfgPath = join(catalog, "code-reviewer", "agent.config.json");
        const raw = JSON.parse(await readFile(cfgPath, "utf8"));
        raw.targets = ["claude-code", "kiro"]; // kiro is not on PATH
        await writeFile(cfgPath, JSON.stringify(raw));

        await install({
          from: catalog,
          // No platformFilter — all declared targets go through detection.
          // detectInstalledPlatforms returns only claude-code, so kiro falls
          // into the skipped set and a PendingOp is recorded for replay.
          detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
          // Route pending ops to the test's state root so we know where to look.
          stateHome: () => join(home, "agent-smith"),
          printErr: () => {},
        });

        // Pending op should be recorded for kiro under
        // <stateRoot>/pending/agent.install/code-reviewer/kiro.json.
        const pendingDir = join(home, "agent-smith", "pending", "agent.install", "code-reviewer");
        const kiroPending = join(pendingDir, "kiro.json");
        const exists = await stat(kiroPending).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      } finally {
        await rm(catalog, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test(
    "emits a JSON envelope on stdout when --json is passed",
    async () => {
      const catalog = await seedCatalog();
      const stdoutChunks: string[] = [];
      const origStdoutWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      }) as typeof process.stdout.write;
      try {
        // --force so the pre-existing code-reviewer.md doesn't block the install
        // and the JSON envelope is emitted even if the run ends non-zero.
        // The envelope is written before resolveAgentSelection, so it always
        // appears regardless of whether the per-bundle install succeeds.
        await install({
          from: catalog,
          json: true,
          all: true,
          force: true,
          platformFilter: ["claude-code"],
          printErr: () => {},
        });
        const stdout = stdoutChunks.join("");
        const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
        expect(line).toBeDefined();
        const parsed = JSON.parse(line!);
        expect(parsed).toHaveProperty("catalogRootPath", catalog);
        expect(parsed).toHaveProperty("bundles");
        expect(Array.isArray(parsed.bundles)).toBe(true);
        expect(parsed).toHaveProperty("detectedGitRemote");
      } finally {
        process.stdout.write = origStdoutWrite;
        await rm(catalog, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
