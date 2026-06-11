import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { knowledgeRemove } from "../../src/cli/commands/knowledge/remove";
import { SmithError } from "../../src/core/smith-error";

describe("knowledgeRemove", () => {
  let dir: string;

  async function writeConfig(cfg: Record<string, unknown>) {
    await writeFile(join(dir, "agent.config.json"), JSON.stringify(cfg, null, 2));
  }

  async function readConfig(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-kr-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("removes a source by id and returns 0", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [
          { id: "schema", type: "file", delivery: "inline", path: "./schema.sql" },
          { id: "docs", type: "webpage", delivery: "auto", url: "https://example.com/docs" },
        ],
      },
    });
    const code = await knowledgeRemove({ bundleDir: dir, sourceId: "schema" });
    expect(code).toBe(0);
    const cfg = await readConfig();
    expect((cfg.knowledge as { sources: Array<{ id: string }> }).sources).toHaveLength(1);
    expect((cfg.knowledge as { sources: Array<{ id: string }> }).sources[0]!.id).toBe("docs");
  });

  it("preserves the order of remaining sources", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [
          { id: "a", type: "file", delivery: "inline", path: "./a.md" },
          { id: "b", type: "file", delivery: "inline", path: "./b.md" },
          { id: "c", type: "file", delivery: "inline", path: "./c.md" },
        ],
      },
    });
    const code = await knowledgeRemove({ bundleDir: dir, sourceId: "b" });
    expect(code).toBe(0);
    const cfg = await readConfig();
    const ids = (cfg.knowledge as { sources: Array<{ id: string }> }).sources.map((s) => s.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("throws SmithError when the source id is not found", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [{ id: "schema", type: "file", delivery: "inline", path: "./schema.sql" }],
      },
    });
    const err = await knowledgeRemove({ bundleDir: dir, sourceId: "missing" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
    // Message lists the available ids so the user can self-correct.
    expect(JSON.stringify((err as SmithError).payload)).toMatch(/missing/);
    expect(JSON.stringify((err as SmithError).payload)).toMatch(/schema/);
  });

  it("throws SmithError when the agent has no knowledge block", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
    });
    const err = await knowledgeRemove({ bundleDir: dir, sourceId: "anything" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  it("throws SmithError when the agent has a knowledge block with no sources", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {},
    });
    const err = await knowledgeRemove({ bundleDir: dir, sourceId: "anything" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  it("throws SmithError when agent.config.json is missing (ENOENT)", async () => {
    const err = await knowledgeRemove({ bundleDir: dir, sourceId: "anything" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("config-missing");
  });

  it("throws SmithError when agent.config.json is malformed JSON", async () => {
    await writeFile(join(dir, "agent.config.json"), "{ not json");
    const err = await knowledgeRemove({ bundleDir: dir, sourceId: "anything" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("validation-failed");
  });

  it("removes the last source and leaves an empty sources array (does not delete the block)", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [{ id: "only", type: "file", delivery: "inline", path: "./only.md" }],
      },
    });
    const code = await knowledgeRemove({ bundleDir: dir, sourceId: "only" });
    expect(code).toBe(0);
    const cfg = await readConfig();
    expect(cfg.knowledge).toBeDefined();
    expect((cfg.knowledge as { sources: unknown[] }).sources).toEqual([]);
  });

  it("preserves unrelated knowledge-block fields (packs, inlineBudget)", async () => {
    await writeConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        packs: ["self-knowledge"],
        inlineBudget: { totalTokens: 4000 },
        sources: [{ id: "schema", type: "file", delivery: "inline", path: "./schema.sql" }],
      },
    });
    const code = await knowledgeRemove({ bundleDir: dir, sourceId: "schema" });
    expect(code).toBe(0);
    const cfg = await readConfig();
    const block = cfg.knowledge as { packs: string[]; inlineBudget: { totalTokens: number } };
    expect(block.packs).toEqual(["self-knowledge"]);
    expect(block.inlineBudget).toEqual({ totalTokens: 4000 });
  });
});
