import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKnowledgeConfig } from "./parse-knowledge-config";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kn-cfg-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseKnowledgeConfig", () => {
  it("returns empty when file missing", async () => {
    expect(await parseKnowledgeConfig({ configPath: join(dir, "nope.json") })).toEqual({
      sources: [],
      invalid: [],
    });
  });

  it("returns empty when no knowledge block", async () => {
    const p = join(dir, "agent.config.json");
    await writeFile(p, JSON.stringify({ name: "x" }));
    expect(await parseKnowledgeConfig({ configPath: p })).toEqual({
      sources: [],
      invalid: [],
    });
  });

  it("parses valid sources, lists invalid ones", async () => {
    const p = join(dir, "agent.config.json");
    await writeFile(
      p,
      JSON.stringify({
        knowledge: {
          sources: [
            { id: "a", type: "file", path: "/x" },
            { id: "b", type: "bogus" },
          ],
        },
      }),
    );
    const r = await parseKnowledgeConfig({ configPath: p });
    expect(r.sources).toHaveLength(1);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.index).toBe(1);
  });

  it("captures inlineBudgetTokens", async () => {
    const p = join(dir, "agent.config.json");
    await writeFile(p, JSON.stringify({ knowledge: { inlineBudgetTokens: 4000, sources: [] } }));
    const r = await parseKnowledgeConfig({ configPath: p });
    expect(r.inlineBudgetTokens).toBe(4000);
  });
});
