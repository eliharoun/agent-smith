import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";

function tempBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "kadd-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: "t",
        description: "Use proactively for testing knowledge add",
        targets: ["kiro"],
        modelTier: "balanced",
      },
      null,
      2,
    ),
  );
  return dir;
}
const common = { agentName: "t", installAfter: false, runInstall: async () => {} };
function readSources(dir: string): any[] {
  const cfg = JSON.parse(readFileSync(join(dir, "agent.config.json"), "utf8"));
  return cfg.knowledge?.sources ?? [];
}

describe("knowledge add web/mcp", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempBundle();
  });
  test("web crawl writes a web source with bounds", async () => {
    await knowledgeAdd({
      ...common,
      bundleDir: dir,
      type: "web",
      pathOrUrl: "https://docs.example.com/",
      mode: "crawl",
      maxPages: 40,
      depth: 3,
    } as any);
    const s = readSources(dir)[0];
    expect(s.type).toBe("web");
    expect(s.mode).toBe("crawl");
    expect(s.maxPages).toBe(40);
    expect(s.depth).toBe(3);
  });
  test("mcp writes a connector source with args", async () => {
    await knowledgeAdd({
      ...common,
      bundleDir: dir,
      type: "mcp",
      server: "notion",
      tool: "search",
      args: { query: "onboarding" },
    } as any);
    const s = readSources(dir)[0];
    expect(s.type).toBe("mcp");
    expect(s.server).toBe("notion");
    expect(s.args).toEqual({ query: "onboarding" });
  });
});
