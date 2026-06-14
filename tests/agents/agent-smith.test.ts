import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../../src/core/config-schema";
import { validateKnowledge } from "../../src/core/knowledge/validator";
import { runKnowledgeStage } from "../../src/core/knowledge/pipeline";

const BUNDLE_DIR = join(import.meta.dir, "..", "..", "agents", "agent-smith");
const GUIDE_DIR = join(import.meta.dir, "..", "..", "guide");

/**
 * Returns the set of `.md` filenames the `agent-smith-guide` knowledge source
 * is expected to materialize. Derived from the on-disk guide directory at
 * test time so adding/removing a guide file doesn't require touching this
 * test — the source ships the full directory (no `include` allowlist).
 */
async function expectedGuideFiles(): Promise<string[]> {
  const entries = await readdir(GUIDE_DIR);
  return entries.filter((name) => name.endsWith(".md")).sort();
}

describe("agents/agent-smith bundle", () => {
  test("agent.config.json validates including the knowledge block", async () => {
    const raw = await readFile(join(BUNDLE_DIR, "agent.config.json"), "utf8");
    const json = JSON.parse(raw);

    // Schema-level validation (the parser).
    const parsed = parseConfig(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return; // narrow
    expect(parsed.data.name).toBe("agent-smith");

    // Knowledge linter operates on the KnowledgeBlock, not the full config.
    const result = validateKnowledge(parsed.data.knowledge);
    expect(result.errors).toEqual([]);
    // Warnings are tolerated (sum-of-budget warnings, etc. are advisory).
  });

  test("knowledge source `agent-smith-guide` is declared with the expected shape", async () => {
    const raw = await readFile(join(BUNDLE_DIR, "agent.config.json"), "utf8");
    const json = JSON.parse(raw);

    expect(json.knowledge).toBeDefined();
    expect(Array.isArray(json.knowledge.sources)).toBe(true);

    const src = json.knowledge.sources.find(
      (s: { id: string }) => s.id === "agent-smith-guide",
    );
    expect(src).toBeDefined();
    expect(src.type).toBe("dir");
    expect(src.path).toBe("../../guide");
    expect(src.delivery).toBe("file");

    // Ship the full guide — no allowlist. Adding an `include` here would
    // silently drop newly-authored guide files from the materialized set.
    expect(src.include).toBeUndefined();

    // Description must mention the agent-facing purpose so the index entry
    // is informative when the agent reads it.
    expect(src.description).toContain("CLI reference");
  });

  test("install pipeline materializes the full guide into the knowledge dir", async () => {
    // Use a tmpdir-rooted knowledge dir so the test doesn't touch the user's
    // ~/.config/opencode/. Pattern mirrors tests/core/knowledge/pipeline.test.ts:46.
    const workDir = await mkdtemp(join(tmpdir(), "agent-smith-bundle-test-"));
    try {
      const knowledgeDir = join(workDir, "knowledge");
      const cacheDir = join(workDir, "cache");

      const raw = await readFile(join(BUNDLE_DIR, "agent.config.json"), "utf8");
      const json = JSON.parse(raw);
      const parsed = parseConfig(json);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const block = parsed.data.knowledge;
      expect(block).toBeDefined();
      if (!block) return;

      const expectedFiles = await expectedGuideFiles();
      const expectedCount = expectedFiles.length;
      // Sanity: we should be shipping at least the v0.15 guide set.
      expect(expectedCount).toBeGreaterThanOrEqual(15);

      const result = await runKnowledgeStage(block, {
        bundleDir: BUNDLE_DIR,
        knowledgeDir,
        cacheDir,
      });

      // Pipeline must report no errors for the source.
      expect(result.errors).toEqual([]);

      // delivery: "file" → all entries go to section.index, none inline.
      expect(result.section.inline).toEqual([]);
      expect(result.section.index.length).toBe(expectedCount);

      // Manifest entry exists with every guide file.
      const summary = result.manifest.sources.find((s) => s.id === "agent-smith-guide");
      expect(summary).toBeDefined();
      expect(summary?.files.length).toBe(expectedCount);

      // Each guide file materialized to disk under sources/<id>/.
      for (const name of expectedFiles) {
        const path = join(knowledgeDir, "sources", "agent-smith-guide", name);
        const st = await stat(path);
        expect(st.isFile()).toBe(true);
        expect(st.size).toBeGreaterThan(0);
      }

      // _manifest.json exists and lists the source.
      const manifestRaw = await readFile(
        join(knowledgeDir, "_manifest.json"),
        "utf8",
      );
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.renderedAt).toBeDefined();
      expect(typeof manifest.renderedAt).toBe("string");
      expect(manifest.sources.length).toBe(1);
      expect(manifest.sources[0].id).toBe("agent-smith-guide");
      expect(manifest.sources[0].files.length).toBe(expectedCount);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
    // Generous timeout: this exercises the real agent-smith config, whose
    // `agent-smith-guide` source is `retrieval: hybrid`, so runKnowledgeStage
    // builds a hybrid index (embedding-model load + per-chunk embeddings).
    // That legitimately exceeds bun:test's 5s default; degrades to lexical
    // (faster) when the on-device model is unavailable (e.g. CI).
  }, 120_000);

  test("EXPERTISE.md no longer hand-curates a CLI command list", async () => {
    const expertise = await readFile(join(BUNDLE_DIR, "EXPERTISE.md"), "utf8");

    // The old inline list used `- \`smith <cmd>\` —` bullets. If any
    // bullet of that exact shape exists, drift has been re-introduced.
    // Match any line starting with `- \`smith ` followed by a non-backtick
    // identifier and a closing backtick + em-dash. Tightly scoped to the
    // inline-command-list pattern; allows other prose mentions of `smith`.
    const driftBulletRe = /^-\s+`smith\s+[a-z][a-z0-9-]*`\s+—/m;
    expect(expertise).not.toMatch(driftBulletRe);
  });

  test("EXPERTISE.md points the agent at the agent-smith-guide knowledge source", async () => {
    const expertise = await readFile(join(BUNDLE_DIR, "EXPERTISE.md"), "utf8");
    expect(expertise).toContain("agent-smith-guide");
    // The pointer paragraph must mention the Knowledge Index and Read tool
    // explicitly so the agent knows the workflow.
    expect(expertise).toContain("Knowledge Index");
    expect(expertise).toContain("Read tool");
  });
});
