// End-to-end orchestrator + renderer coverage for the knowledge-refresh
// doctor section.
//
// The detection module (checkRefreshHooks) is unit-tested separately in
// check-refresh-hooks.test.ts. These tests verify the wiring through
// runDoctor (emitStart / emitDone, report.knowledgeRefresh population)
// and the formatReport renderer block, which were previously uncovered.
//
// Uses real fs in a tmpdir; no mocks.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dump } from "js-yaml";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import { formatReport } from "../../../src/core/freshness/format";
import { runDoctor } from "../../../src/core/freshness/run-doctor";
import type {
  CheckRefreshHooksInput,
} from "../../../src/core/freshness/check-refresh-hooks";
import type {
  DoctorDeps,
  SchemaMeta,
  ToolMapMeta,
} from "../../../src/core/freshness/types";
import { writeRefreshManifest } from "../../../src/core/knowledge/refresh-manifest";

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools",
  notes: "",
};
const codexMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "https://github.com/openai/codex",
  notes: "",
};
const schemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "https://opencode.ai/config.json",
  schemaId: null,
  version: null,
  notes: "",
};
const vendoredSchema = { properties: { agent: { type: "object" } } };

function deps(): DoctorDeps {
  const cacheIO = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-02T00:00:00.000Z"),
    readCache: cacheIO.readCache,
    writeCache: cacheIO.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
  };
}

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
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-rd-refresh-"));
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

function knowledgeRefreshInput(): CheckRefreshHooksInput {
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

describe("runDoctor: knowledgeRefresh section (orchestrator + renderer)", () => {
  test("warn path: seeded missing-hook surfaces in report + formatReport output, fires start/done events", async () => {
    // Agent "bob" consented to claude-code refresh, is installed there,
    // but the agent .md has no hooks block → missing-hook finding.
    await writeRefreshManifest(ctx.agentSmithHome, "bob", {
      schemaVersion: 1,
      agent: "bob",
      refresh_consent: {
        granted_at: "2026-01-01T00:00:00.000Z",
        platforms: ["claude-code"],
        sources: ["docs"],
      },
    });
    await writeClaudeAgent("bob", {});

    const events: Array<{ kind: "start" | "done"; id: string; status?: string }> = [];
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      knowledgeRefresh: knowledgeRefreshInput(),
      onSectionStart: (e) => events.push({ kind: "start", id: e.id }),
      onSectionDone: (e) => events.push({ kind: "done", id: e.id, status: e.status }),
    });

    // Report wiring.
    expect(report.knowledgeRefresh).toBeDefined();
    expect(report.knowledgeRefresh?.status).toBe("warn");
    expect(report.knowledgeRefresh?.findings).toEqual([
      { kind: "missing-hook", agent: "bob", platform: "claude-code" },
    ]);

    // Orchestrator events.
    const krEvents = events.filter((e) => e.id === "knowledge-refresh");
    expect(krEvents).toHaveLength(2);
    expect(krEvents[0]?.kind).toBe("start");
    expect(krEvents[1]?.kind).toBe("done");
    expect(krEvents[1]?.status).toBe("warn");

    // Renderer block.
    const rendered = formatReport(report);
    expect(rendered).toContain("Knowledge refresh:");
    expect(rendered).toContain("[missing-hook]");
    expect(rendered).toContain("bob");
  });

  test("ok path: no consented agents → status ok, renderer prints clean section", async () => {
    // Pristine agent-smith home (no agents/<x>/refresh-manifest.json) →
    // detector finds nothing.
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      knowledgeRefresh: knowledgeRefreshInput(),
    });

    expect(report.knowledgeRefresh).toBeDefined();
    expect(report.knowledgeRefresh?.status).toBe("ok");
    expect(report.knowledgeRefresh?.findings).toEqual([]);

    const rendered = formatReport(report);
    expect(rendered).toContain("Knowledge refresh:");
    expect(rendered).toContain("Status: ok");
  });

  test("section absent when knowledgeRefresh input omitted (back-compat)", async () => {
    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
    });
    expect(report.knowledgeRefresh).toBeUndefined();
    const rendered = formatReport(report);
    expect(rendered).not.toContain("Knowledge refresh:");
  });
});
