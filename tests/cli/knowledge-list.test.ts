import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { knowledgeList } from "../../src/cli/commands/knowledge/list";
import { SmithError } from "../../src/core/smith-error";

describe("knowledgeList", () => {
  let dir: string;
  let agentSmithHome: string;
  const spies: Array<ReturnType<typeof spyOn>> = [];
  beforeEach(async () => {
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-kl-"));
    dir = join(agentSmithHome, "knowledge", "x");
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(agentSmithHome, { recursive: true, force: true });
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("back-compat: with no DI, returns 'installed knowledge not found' when no manifest", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const err = await knowledgeList("x", { agentSmithHome }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("installed knowledge");
    expect(err.payload.identifier).toBe("x");
  });

  it("prints a per-source summary table when a manifest is present", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    await writeFile(
      join(dir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-03T00:00:00Z",
        sources: [
          {
            id: "schema",
            scope: "agent",
            type: "file",
            delivery: "inline",
            files: [{ path: "sources/schema/x.sql", sha256: "abc", bytes: 9 }],
            tokensInline: 12,
            description: "DB",
          },
        ],
        totals: { tokensInline: 12, tokensInlineBudget: 8000, files: 1, bytes: 9 },
      }),
    );
    const code = await knowledgeList("x", { agentSmithHome });
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("schema");
    expect(out).toContain("inline");
    expect(out).toContain("12");
    expect(out).toContain("8000");
  });

  it("state A — agent not found: throws not-found(agent) with init-agent suggestion", async () => {
    const err = await knowledgeList("ghost", { agentSmithHome }, {
      loadDeclaredSources: async () => null,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("agent");
    expect(err.payload.identifier).toBe("ghost");
    expect(err.payload.suggestedCommand).toContain("agent init");
  });

  it("state B — agent exists, zero sources: exit 0, prints 'no sources' + add hint", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeList("x", { agentSmithHome }, {
      loadDeclaredSources: async () => [],
    });
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toMatch(/no knowledge sources declared/i);
    expect(out).toContain("smith knowledge add x");
  });

  it("state C — sources declared but not materialized: exit 0, lists declarations + install hint", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeList("x", { agentSmithHome }, {
      loadDeclaredSources: async () => [
        {
          id: "opencode-docs",
          type: "webpage",
          delivery: "auto",
          url: "https://opencode.ai/docs",
          description: "Live OpenCode docs",
        },
      ],
    });
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toMatch(/declared but not yet materialized/i);
    expect(out).toContain("opencode-docs");
    expect(out).toContain("https://opencode.ai/docs");
    expect(out).toContain("smith agent install x");
  });

  it("state D — sources declared AND materialized: shows manifest table, ignores declared list", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    await writeFile(
      join(dir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-03T00:00:00Z",
        sources: [
          {
            id: "opencode-docs",
            scope: "agent",
            type: "webpage",
            delivery: "inline",
            files: [{ path: "sources/opencode-docs/docs.html", sha256: "abc", bytes: 100 }],
            tokensInline: 1804,
          },
        ],
        totals: { tokensInline: 1804, tokensInlineBudget: 8000, files: 1, bytes: 100 },
      }),
    );
    const code = await knowledgeList("x", { agentSmithHome }, {
      loadDeclaredSources: async () => [
        {
          id: "opencode-docs",
          type: "webpage",
          delivery: "auto",
          url: "https://opencode.ai/docs",
        },
      ],
    });
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("rendered 2026-05-03");
    expect(out).toContain("1804");
    expect(out).not.toMatch(/declared but not yet materialized/i);
  });
});
