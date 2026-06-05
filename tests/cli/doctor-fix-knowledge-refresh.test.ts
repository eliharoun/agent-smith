/**
 * End-to-end CLI coverage for `smith doctor --fix-knowledge-refresh`.
 *
 * Drives runDoctorCli with injected paths so the auto-repair runs against
 * a hermetic tmpdir. Asserts each finding kind triggers the right repair:
 *
 *   - missing-hook       → reconfigureAgent re-registers the hook (frontmatter
 *                          gains a SessionStart smith-refresh entry).
 *   - corrupt-cache      → the `.meta.json` file is deleted.
 *   - orphaned-consent   → reconfigureAgent removes the platform from the
 *                          per-agent refresh manifest.
 *   - unmanaged-codex-hooks → no file mutation; output mentions migrate-codex.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { dump } from "js-yaml";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import { writeRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import type { PlatformId } from "../../src/io/platform-detect";

const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex"]);

interface Ctx {
  root: string;
  agentSmithHome: string;
  cacheRoot: string;
  claudeAgentsDir: string;
  codexAgentsDir: string;
  kiroAgentsDir: string;
  opencodeAgentsDir: string;
  codexHome: string;
  opencodeConfigHome: string;
  schemaCachePath: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-fix-kr-"));
  ctx = {
    root,
    agentSmithHome: join(root, "agent-smith-home"),
    cacheRoot: join(root, "cache"),
    claudeAgentsDir: join(root, "claude", "agents"),
    codexAgentsDir: join(root, "codex-skills"),
    kiroAgentsDir: join(root, "kiro", "agents"),
    opencodeAgentsDir: join(root, "opencode", "agents"),
    codexHome: join(root, "codex-home"),
    opencodeConfigHome: join(root, "opencode-cfg"),
    schemaCachePath: join(root, "schema-cache.json"),
  };
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

function knowledgeRefreshPaths() {
  return {
    agentSmithHome: ctx.agentSmithHome,
    cacheRoot: ctx.cacheRoot,
    installPaths: {
      "claude-code": ctx.claudeAgentsDir,
      codex: ctx.codexAgentsDir,
      kiro: ctx.kiroAgentsDir,
      opencode: ctx.opencodeAgentsDir,
    },
    codexHome: ctx.codexHome,
    opencodeConfigHome: ctx.opencodeConfigHome,
  };
}

async function writeClaudeAgentMd(
  agent: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  await mkdir(ctx.claudeAgentsDir, { recursive: true });
  const fm = dump({ name: agent, ...frontmatter }, { lineWidth: 0, sortKeys: true });
  await writeFile(
    join(ctx.claudeAgentsDir, `${agent}.md`),
    `---\n${fm}---\n\nbody\n`,
    "utf8",
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function commonCliOpts(stdoutSink: { value: string }) {
  return {
    detectInstalledPlatforms: allPlatforms,
    offline: true,
    noCache: false,
    json: false,
    skipModelResolution: true,
    cachePath: ctx.schemaCachePath,
    print: (s: string) => {
      stdoutSink.value += `${s}\n`;
    },
  } as const;
}

describe("runDoctorCli --fix-knowledge-refresh", () => {
  test("missing-hook → reconfigureAgent re-registers the claude-code hook", async () => {
    // Seed: claude-code agent .md without any hooks block.
    await writeClaudeAgentMd("zephyr", {});
    // Manifest consents zephyr for claude-code.
    await writeRefreshManifest(ctx.agentSmithHome, "zephyr", {
      schemaVersion: 1,
      agent: "zephyr",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["claude-code"],
        sources: ["docs"],
      },
    });

    const stdout = { value: "" };
    const code = await runDoctorCli({
      ...commonCliOpts(stdout),
      fixKnowledgeRefresh: true,
      knowledgeRefreshPaths: knowledgeRefreshPaths(),
    });
    expect(code).toBeGreaterThanOrEqual(0); // we don't assert exit code here

    // Frontmatter now contains the smith refresh hook.
    const raw = await readFile(join(ctx.claudeAgentsDir, "zephyr.md"), "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as { hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> } };
    expect(fm.hooks).toBeDefined();
    const sessionStart = fm.hooks?.SessionStart;
    expect(Array.isArray(sessionStart)).toBe(true);
    const commands = (sessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ""));
    expect(commands.some((c) => c.includes("--agent zephyr") && c.includes("--platform claude-code"))).toBe(true);

    // Manifest still consents zephyr for claude-code (no change).
    const manifestRaw = await readFile(
      join(ctx.agentSmithHome, "refresh", "zephyr", "refresh-manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as {
      refresh_consent: { platforms: string[] };
    };
    expect(manifest.refresh_consent.platforms).toContain("claude-code");

    // Output mentions the repair.
    expect(stdout.value).toMatch(/re-registered.*claude-code.*zephyr/);
  });

  test("corrupt-cache → fix deletes the .meta.json", async () => {
    // Seed: a corrupt meta.json under the cache root.
    const sourceDir = join(ctx.cacheRoot, "agents", "yara", "sources");
    await mkdir(sourceDir, { recursive: true });
    const metaPath = join(sourceDir, "src-1.meta.json");
    await writeFile(metaPath, "{not valid json", "utf8");
    // Manifest exists so the detector enumerates this agent.
    await writeRefreshManifest(ctx.agentSmithHome, "yara", {
      schemaVersion: 1,
      agent: "yara",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: [],
        sources: ["src-1"],
      },
    });

    const stdout = { value: "" };
    await runDoctorCli({
      ...commonCliOpts(stdout),
      fixKnowledgeRefresh: true,
      knowledgeRefreshPaths: knowledgeRefreshPaths(),
    });

    // File is gone.
    expect(await fileExists(metaPath)).toBe(false);
    // Output mentions deletion.
    expect(stdout.value).toMatch(/deleted corrupt cache.*yara.*src-1/);
  });

  test("orphaned-consent → fix removes the platform from the manifest", async () => {
    // Seed: manifest consents xander for codex, but xander is NOT installed
    // for codex (no SKILL.md at codexAgentsDir/xander/SKILL.md).
    await writeRefreshManifest(ctx.agentSmithHome, "xander", {
      schemaVersion: 1,
      agent: "xander",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["codex"],
        sources: [],
      },
    });

    const stdout = { value: "" };
    await runDoctorCli({
      ...commonCliOpts(stdout),
      fixKnowledgeRefresh: true,
      knowledgeRefreshPaths: knowledgeRefreshPaths(),
    });

    // Manifest no longer consents to codex.
    const manifestRaw = await readFile(
      join(ctx.agentSmithHome, "refresh", "xander", "refresh-manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as {
      refresh_consent: { platforms: string[] };
    };
    expect(manifest.refresh_consent.platforms).not.toContain("codex");
    // Output mentions the repair.
    expect(stdout.value).toMatch(/cleared orphan consent.*xander.*codex/);
  });

  test("unmanaged-codex-hooks → fix prints actionable message without modifying file", async () => {
    // Seed: a hand-written codex hooks.json with a SessionStart entry but
    // no _smith_managed sentinel.
    await mkdir(ctx.codexHome, { recursive: true });
    const codexHooksPath = join(ctx.codexHome, "hooks.json");
    const handWritten = JSON.stringify(
      {
        hooks: {
          SessionStart: [
            { command: "echo user-hook" },
          ],
        },
      },
      null,
      2,
    );
    await writeFile(codexHooksPath, handWritten, "utf8");

    const stdout = { value: "" };
    await runDoctorCli({
      ...commonCliOpts(stdout),
      fixKnowledgeRefresh: true,
      knowledgeRefreshPaths: knowledgeRefreshPaths(),
    });

    // File is byte-identical.
    const after = await readFile(codexHooksPath, "utf8");
    expect(after).toBe(handWritten);
    // Output mentions migrate-codex.
    expect(stdout.value).toMatch(/smith knowledge migrate-codex/);
  });

  // Note: `consent-without-need` reclassification path is exercised by
  // the unit test in tests/core/freshness/check-refresh-hooks.test.ts.
  // An end-to-end test through runDoctorCli would require registering a
  // real bundle in the test registry (the reclassification reads the
  // bundle's session/always source list); the unit-level coverage plus
  // the existing orphaned-consent integration test (which exercises the
  // same `reconfigureAgent({ revoke })` primitive) is sufficient.
});
