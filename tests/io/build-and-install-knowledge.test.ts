import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildAndInstall } from "../../src/io/orchestrator";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import type { InstallPaths } from "../../src/core/types";
import { FAIL_CHARS } from "../../src/core/validator";
import { DEFAULT_INLINE_BUDGET } from "../../src/core/knowledge/validator";
import { fakeBundle } from "../_helpers/fakeBundle";

describe("buildAndInstall with knowledge", () => {
  let bundleDir: string;
  let opencodeAgentsDir: string;
  let claudeAgentsDir: string;
  let codexAgentsDir: string;
  let kiroAgentsDir: string;
  let agentSmithHome: string;
  let knowledgeRoot: string;
  let paths: InstallPaths;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-bi-bundle-"));
    opencodeAgentsDir = await mkdtemp(join(tmpdir(), "smith-bi-oc-"));
    claudeAgentsDir = await mkdtemp(join(tmpdir(), "smith-bi-cc-"));
    codexAgentsDir = await mkdtemp(join(tmpdir(), "smith-bi-cx-"));
    kiroAgentsDir = await mkdtemp(join(tmpdir(), "smith-bi-kiro-"));
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-bi-as-"));
    knowledgeRoot = join(agentSmithHome, "knowledge");
    paths = {
      opencode: opencodeAgentsDir,
      "claude-code": claudeAgentsDir,
      codex: codexAgentsDir,
      kiro: kiroAgentsDir,
      "agents-md": join(agentSmithHome, "agents-md"),
    };
    await writeFile(join(bundleDir, "schema.sql"), "select 1;");
  });

  afterEach(async () => {
    for (const d of [
      bundleDir,
      opencodeAgentsDir,
      claudeAgentsDir,
      codexAgentsDir,
      kiroAgentsDir,
      agentSmithHome,
    ]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  const modelResolutionEnv: ModelResolutionEnv = {
    getOpenCodeModels: async () => undefined,
    warnings: { push() {} },
    detectAuthenticatedProviders: async () => ["github-copilot"],
  };

  it("runs the knowledge stage, installs, and writes manifest", async () => {
    const bundle = fakeBundle("kn-test", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "schema",
          type: "file",
          path: "./schema.sql",
          delivery: "inline",
          description: "DB schema",
        },
      ],
    };

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      homeDir: agentSmithHome,
    });

    expect(result.errors).toEqual([]);

    // Manifest exists in the canonical knowledge home, which lives under
    // agent-smith's own state dir (NOT under any platform's agent-discovery
    // scope — see the bug fix that relocated knowledge out of opencode's
    // recursive agent picker).
    const manifest = JSON.parse(
      await readFile(join(knowledgeRoot, "kn-test", "_manifest.json"), "utf8"),
    );
    expect(manifest.sources[0].id).toBe("schema");

    // OpenCode frontmatter contains the implicit read grant for the knowledge dir.
    const ocPath = result.installed.find((i) => i.target === "opencode")?.path;
    expect(ocPath).toBeDefined();
    const ocBody = await readFile(ocPath as string, "utf8");
    expect(ocBody).toContain("/knowledge/kn-test/**");
    // Inline content reaches the assembled body
    expect(ocBody).toContain("## Knowledge");
    expect(ocBody).toContain("select 1;");

    // OrchestratorResult exposes the granted dir for CLI summary rendering.
    expect(result.grantedKnowledgeDirs).toEqual([
      { agent: "kn-test", dir: join(knowledgeRoot, "kn-test") },
    ]);

    // Critical anti-regression: the knowledge dir must NOT be inside the
    // opencode agents dir (where opencode's picker would discover it).
    expect(result.grantedKnowledgeDirs[0]?.dir.startsWith(opencodeAgentsDir)).toBe(false);
  });

  it("surfaces validator errors as install errors when knowledge is malformed", async () => {
    const bundle = fakeBundle("kn-bad", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    bundle.config.knowledge = {
      sources: [{ id: "x", type: "git", url: "https://example.com/y.git", delivery: "file" }],
    };

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      homeDir: agentSmithHome,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.messages.some((m) => m.includes("git"))).toBe(true);
  });

  it("surfaces total-body limit error when prose + knowledge exceeds budget", async () => {
    // Sizes derived from validator constants — adjusts automatically if budgets
    // change. Prose targets the prose-only fail (FAIL_CHARS) from below; knowledge
    // pushes the FINAL body over the knowledge-aware fail (FAIL_CHARS + 4*budget chars).
    // Knowledge content uses varied English-like text so the gpt-tokenizer estimate
    // stays under the inline budget (otherwise the pipeline demotes inline -> file
    // and the body never grows enough to trip the check).
    const proseChunk = "line of prose here. "; // 20 chars
    const proseTarget = FAIL_CHARS - 1_000; // safely under prose-only fail
    // assembleBody concatenates four files with separators, so split target across them.
    const proseRepeats = Math.ceil(proseTarget / 4 / proseChunk.length);

    const knowledgeChunk = "lorem ipsum dolor sit amet consectetur adipiscing elit. "; // 56 chars
    const knowledgeAllowanceChars = DEFAULT_INLINE_BUDGET * 4; // chars allowance (validator: 4 chars/token)
    const knowledgeTarget = knowledgeAllowanceChars + 5_000; // safely over the total-body fail
    const knowledgeRepeats = Math.ceil(knowledgeTarget / knowledgeChunk.length);

    const big = knowledgeChunk.repeat(knowledgeRepeats);
    await writeFile(join(bundleDir, "big.txt"), big);

    const bundle = fakeBundle("kn-huge", {
      bundlePath: bundleDir,
      targets: ["opencode"],
      identity: `You are X.\n${proseChunk.repeat(proseRepeats)}`,
      expertise: `You do Y.\n${proseChunk.repeat(proseRepeats)}`,
      soul: `You speak.\n${proseChunk.repeat(proseRepeats)}`,
      user: `You note.\n${proseChunk.repeat(proseRepeats)}`,
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "big",
          type: "file",
          path: "./big.txt",
          delivery: "inline",
          inlineBudgetTokens: DEFAULT_INLINE_BUDGET,
          description: "huge inline blob",
        },
      ],
    };

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      homeDir: agentSmithHome,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.messages.some((m) => /exceeds hard limit/.test(m))).toBe(true);
  });

  it("populates result.knowledge for agents with knowledge", async () => {
    // Per plan Task 6: orchestrator must surface a per-agent KnowledgeSummary
    // on result.knowledge for downstream CLI rendering. First-time install →
    // no prior manifest → every source must be marked changed:true.
    await writeFile(join(bundleDir, "facts.md"), "hello world");
    const bundle = fakeBundle("kn-summary", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    bundle.config.knowledge = {
      sources: [{ id: "facts", type: "file", path: "facts.md", delivery: "file" }],
    };

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      homeDir: agentSmithHome,
    });

    expect(result.errors).toEqual([]);
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0]?.agent).toBe(bundle.config.name);
    expect(result.knowledge[0]?.sources).toHaveLength(1);
    expect(result.knowledge[0]?.sources[0]?.id).toBe("facts");
    expect(result.knowledge[0]?.sources[0]?.changed).toBe(true);
    expect(result.knowledge[0]?.totals.files).toBe(1);
    expect(result.knowledge[0]?.totals.bytes).toBeGreaterThan(0);
  });

  it("agent with one optional broken source builds successfully (CORE-8)", async () => {
    const bundle = fakeBundle("kn-opt-test", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "schema",
          type: "file",
          path: "./schema.sql",
          delivery: "inline",
          description: "DB schema",
        },
        {
          id: "missing",
          type: "file",
          path: "./does-not-exist.md",
          delivery: "inline",
          optional: true,
        },
      ],
    };

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      homeDir: agentSmithHome,
    });

    // Agent SHOULD build successfully despite the optional broken source.
    expect(result.errors).toEqual([]);
    // Warning should surface the optional failure under the agent/knowledge prefix.
    expect(
      result.warnings.some(
        (w) => w.includes("kn-opt-test") && w.includes("optional source failed"),
      ),
    ).toBe(true);
    // The good source should be installed/manifested; broken one omitted.
    const manifest = JSON.parse(
      await readFile(join(knowledgeRoot, "kn-opt-test", "_manifest.json"), "utf8"),
    );
    expect(manifest.sources.map((s: { id: string }) => s.id)).toEqual(["schema"]);
  });
});
