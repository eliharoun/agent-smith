// Doctor's knowledge-refresh section. Pure detection — read-only.
//
// Verifies checkRefreshHooks() classifies, per installed agent, four
// kinds of drift between the recorded refresh-manifest consent and the
// on-disk state of platform hook config:
//
//   - missing-hook         (manifest consents, hook absent on disk)
//   - orphaned-consent     (manifest consents, agent not installed there)
//   - corrupt-cache        (.meta.json present but unparseable / off-schema)
//   - unmanaged-codex-hooks (hooks.json present without _smith_managed
//                            sentinel and contains a SessionStart hook)
//
// All cases use real fs in a temp dir; no mocks for the detection itself.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dump } from "js-yaml";
import {
  checkRefreshHooks,
  type CheckRefreshHooksInput,
} from "../../../src/core/freshness/check-refresh-hooks";
import { writeRefreshManifest } from "../../../src/core/knowledge/refresh-manifest";
import { writeRefreshCache } from "../../../src/core/knowledge/refresh-cache";

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
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-refresh-"));
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
  };
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

function input(): CheckRefreshHooksInput {
  return {
    agentSmithHome: ctx.agentSmithHome,
    cacheRoot: ctx.cacheRoot,
    installPaths: {
      "claude-code": ctx.claudeAgentsDir,
      codex: ctx.codexAgentsDir,
      kiro: ctx.kiroAgentsDir,
      opencode: ctx.opencodeAgentsDir,
    },
    codexHooksPath: join(ctx.codexHome, "hooks.json"),
    opencodeConfigHome: ctx.opencodeConfigHome,
  };
}

/** Write a claude-code agent .md file with given frontmatter at the
 *  standard install location used by src/io/installer.ts. */
async function writeClaudeAgent(
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

/** Write a codex agent at <codexAgentsDir>/<agent>/SKILL.md to mark
 *  it "installed for codex". */
async function writeCodexAgent(agent: string): Promise<void> {
  const dir = join(ctx.codexAgentsDir, agent);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "---\nname: x\n---\nbody\n", "utf8");
}

/** Write a smith-managed codex hooks.json registering the given agents. */
async function writeSmithManagedCodexHooks(agents: string[]): Promise<void> {
  await mkdir(ctx.codexHome, { recursive: true });
  const doc = {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: "smith knowledge refresh-session --platform codex",
              statusMessage: "smith: refreshing knowledge…",
              timeout: 5,
            },
          ],
        },
      ],
    },
    _smith_managed: { agents, installed_at: "2026-01-01T00:00:00.000Z" },
  };
  await writeFile(join(ctx.codexHome, "hooks.json"), JSON.stringify(doc, null, 2), "utf8");
}

describe("checkRefreshHooks", () => {
  test("ok: manifest consent + on-disk hooks agree", async () => {
    // Agent installed everywhere it consented; hooks/sentinels present.
    await writeRefreshManifest(ctx.agentSmithHome, "alice", {
      schemaVersion: 1,
      agent: "alice",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["claude-code"],
        sources: ["docs"],
      },
    });
    await writeClaudeAgent("alice", {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [
              {
                type: "command",
                command:
                  "smith knowledge refresh-session --agent alice --platform claude-code",
                timeout: 5,
              },
            ],
          },
        ],
      },
    });

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("ok");
    expect(report.findings).toEqual([]);
  });

  test("missing-hook: claude-code consented but agent .md has no hooks block", async () => {
    await writeRefreshManifest(ctx.agentSmithHome, "bob", {
      schemaVersion: 1,
      agent: "bob",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["claude-code"],
        sources: ["docs"],
      },
    });
    // Agent is installed (file exists) but the hooks block was wiped.
    await writeClaudeAgent("bob", {});

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("warn");
    expect(report.findings).toEqual([
      { kind: "missing-hook", agent: "bob", platform: "claude-code" },
    ]);
  });

  test("orphaned-consent: manifest consents codex but agent not installed for codex", async () => {
    await writeRefreshManifest(ctx.agentSmithHome, "carol", {
      schemaVersion: 1,
      agent: "carol",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["codex"],
        sources: ["docs"],
      },
    });
    // No codex agent dir for carol; no hooks.json either.

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("warn");
    expect(report.findings).toEqual([
      { kind: "orphaned-consent", agent: "carol", platform: "codex" },
    ]);
  });

  test("corrupt-cache: malformed .meta.json yields corrupt-cache finding", async () => {
    await writeRefreshManifest(ctx.agentSmithHome, "dave", {
      schemaVersion: 1,
      agent: "dave",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: [],
        sources: ["docs"],
      },
    });
    // Place a corrupt cache file under <cacheRoot>/agents/dave/sources/.
    const sourcesDir = join(ctx.cacheRoot, "agents", "dave", "sources");
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(sourcesDir, "docs.meta.json"), "{not json", "utf8");

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("warn");
    expect(report.findings).toEqual([
      { kind: "corrupt-cache", agent: "dave", sourceId: "docs" },
    ]);
  });

  test("unmanaged-codex-hooks: hooks.json without _smith_managed but containing SessionStart", async () => {
    // No agents, no manifest — just the global codex check.
    await mkdir(ctx.codexHome, { recursive: true });
    const userOwned = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "echo hi" }],
          },
        ],
      },
    };
    const codexHooksPath = join(ctx.codexHome, "hooks.json");
    await writeFile(codexHooksPath, JSON.stringify(userOwned, null, 2), "utf8");

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("warn");
    expect(report.findings).toEqual([
      { kind: "unmanaged-codex-hooks", path: codexHooksPath },
    ]);
  });

  // Sanity: when a smith-managed hooks.json exists and the manifest
  // matches, we should NOT flag unmanaged-codex-hooks.
  test("ok: smith-managed codex hooks.json + matching codex consent + codex install", async () => {
    await writeRefreshManifest(ctx.agentSmithHome, "eve", {
      schemaVersion: 1,
      agent: "eve",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["codex"],
        sources: ["docs"],
      },
    });
    await writeCodexAgent("eve");
    await writeSmithManagedCodexHooks(["eve"]);

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("ok");
    expect(report.findings).toEqual([]);
  });

  // A valid cache entry must NOT trigger corrupt-cache.
  test("ok: valid cache entry produces no findings", async () => {
    await writeRefreshManifest(ctx.agentSmithHome, "frank", {
      schemaVersion: 1,
      agent: "frank",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: [],
        sources: ["docs"],
      },
    });
    await writeRefreshCache(ctx.cacheRoot, "frank", "docs", {
      schemaVersion: 1,
      last_refreshed_at: "2026-01-02T00:00:00.000Z",
      last_attempt_at: "2026-01-02T00:00:00.000Z",
      last_error: null,
    });

    const report = await checkRefreshHooks(input());
    expect(report.status).toBe("ok");
    expect(report.findings).toEqual([]);
  });
});

describe("checkRefreshHooks — installedPlatforms gating", () => {
  test("reclassifies orphaned-consent to stale-consent-uninstalled when platform not installed", async () => {
    // Manifest consents to opencode + claude-code; only claude-code is on PATH.
    // The opencode entry should reclassify to stale-consent-uninstalled (info)
    // rather than orphaned-consent (warn).
    await writeRefreshManifest(ctx.agentSmithHome, "xena", {
      schemaVersion: 1,
      agent: "xena",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["opencode", "claude-code"],
        sources: ["docs"],
      },
    });
    const report = await checkRefreshHooks({
      ...input(),
      installedPlatforms: new Set(["claude-code"]),
    });
    const stale = report.findings.find((f) => f.kind === "stale-consent-uninstalled");
    expect(stale).toBeDefined();
    if (stale && stale.kind === "stale-consent-uninstalled") {
      expect(stale.platform).toBe("opencode");
      expect(stale.agent).toBe("xena");
    }
    // claude-code IS installed (in installedPlatforms) so its handling
    // continues into the existing isAgentInstalled check — it should NOT
    // be classified as stale-consent-uninstalled.
    const stalecc = report.findings.find(
      (f) => f.kind === "stale-consent-uninstalled" && f.platform === "claude-code",
    );
    expect(stalecc).toBeUndefined();
    // Section status must NOT be bumped to warn solely by stale-consent-uninstalled.
    const onlyStale = report.findings.every((f) => f.kind === "stale-consent-uninstalled");
    if (onlyStale) {
      expect(report.status).toBe("ok");
    }
  });

  test("skips unmanaged-codex-hooks check when codex not installed", async () => {
    // Write an unmanaged codex hooks.json. With codex NOT in installedPlatforms,
    // the global check must not emit unmanaged-codex-hooks.
    await mkdir(ctx.codexHome, { recursive: true });
    const userOwned = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "echo hi" }],
          },
        ],
      },
    };
    await writeFile(
      join(ctx.codexHome, "hooks.json"),
      JSON.stringify(userOwned, null, 2),
      "utf8",
    );
    const report = await checkRefreshHooks({
      ...input(),
      installedPlatforms: new Set(["claude-code"]),
    });
    const unmanaged = report.findings.find((f) => f.kind === "unmanaged-codex-hooks");
    expect(unmanaged).toBeUndefined();
  });
});
