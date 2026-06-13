import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";

let bundleDir: string;

beforeEach(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "kadd-hybrid-notice-"));
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      name: "test-agent",
      description: "Use proactively for testing.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "all",
    }),
  );
});
afterEach(async () => {
  await rm(bundleDir, { recursive: true, force: true });
});

async function captureLogs(opts: Parameters<typeof knowledgeAdd>[0]): Promise<string> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await knowledgeAdd(opts);
  } finally {
    console.log = orig;
  }
  return logs.join("\n");
}

describe("knowledgeAdd hybrid restart notice", () => {
  it("emits a restart notice for --retrieval hybrid (non-lazy)", async () => {
    const out = await captureLogs({
      bundleDir,
      agentName: "test-agent",
      type: "file",
      pathOrUrl: "./README.md",
      retrieval: "hybrid",
      installAfter: false,
    });
    expect(out).toMatch(/hybrid/i);
    expect(out).toMatch(/restart/i);
    expect(out).toMatch(/MCP server/i);
    // mentions the agent's knowledge server name and the /mcp reconnect hint
    expect(out).toMatch(/test-agent-knowledge/);
    expect(out).toMatch(/\/mcp/);
  });

  it("does NOT emit the restart notice for --retrieval bm25", async () => {
    const out = await captureLogs({
      bundleDir,
      agentName: "test-agent",
      type: "file",
      pathOrUrl: "./README.md",
      retrieval: "bm25",
      installAfter: false,
    });
    expect(out).not.toMatch(/Restart the knowledge MCP server/);
  });

  it("does NOT emit the restart notice for --retrieval hybrid --lazy", async () => {
    const out = await captureLogs({
      bundleDir,
      agentName: "test-agent",
      type: "webpage",
      pathOrUrl: "https://wiki.example/x",
      lazy: true,
      retrieval: "hybrid",
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(out).not.toMatch(/Restart the knowledge MCP server/);
    // the existing lazy+retrieval warning fires instead
    expect(out).toMatch(/--retrieval hybrid is ignored on lazy sources/);
  });

  it("does NOT emit the restart notice when --retrieval is not passed", async () => {
    const out = await captureLogs({
      bundleDir,
      agentName: "test-agent",
      type: "file",
      pathOrUrl: "./README.md",
      installAfter: false,
    });
    expect(out).not.toMatch(/Restart the knowledge MCP server/);
  });
});
