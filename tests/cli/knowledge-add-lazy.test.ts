import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";

let bundleDir: string;

beforeEach(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "kadd-lazy-"));
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

describe("knowledgeAdd --lazy", () => {
  it("saves a lazy: true URL source", async () => {
    const exit = await knowledgeAdd({
      bundleDir,
      type: "webpage",
      pathOrUrl: "https://wiki.internal.example.com/x",
      lazy: true,
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const source = cfg.knowledge.sources.at(-1);
    expect(source.type).toBe("webpage");
    expect(source.lazy).toBe(true);
    expect(source.delivery).toBeUndefined(); // schema forbids delivery on lazy
    expect(source.description).toMatch(/Platform architecture wiki/);
  });

  it("rejects --lazy on non-URL types", async () => {
    await expect(
      knowledgeAdd({
        bundleDir,
        type: "file",
        pathOrUrl: "./README.md",
        lazy: true,
        installAfter: false,
      } as Parameters<typeof knowledgeAdd>[0]),
    ).rejects.toThrow(/lazy.*webpage/i);
  });

  it("warns when --lazy is set with no description", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await knowledgeAdd({
        bundleDir,
        type: "webpage",
        pathOrUrl: "https://wiki.example/x",
        lazy: true,
        installAfter: false,
      });
    } finally {
      console.log = orig;
    }
    expect(logs.join("\n")).toMatch(/description.*lazy|lazy.*description/i);
  });
});

describe("knowledgeAdd --lazy + --retrieval", () => {
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

  it("warns that --retrieval is ignored when combined with --lazy", async () => {
    const out = await captureLogs({
      bundleDir,
      type: "webpage",
      pathOrUrl: "https://wiki.example/x",
      lazy: true,
      retrieval: "hybrid",
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(out).toMatch(/--retrieval hybrid is ignored on lazy sources/);
  });

  it("does NOT warn for --retrieval off combined with --lazy", async () => {
    const out = await captureLogs({
      bundleDir,
      type: "webpage",
      pathOrUrl: "https://wiki.example/x",
      lazy: true,
      retrieval: "off",
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(out).not.toMatch(/ignored on lazy sources/);
  });

  it("does NOT warn for --lazy alone (no --retrieval)", async () => {
    const out = await captureLogs({
      bundleDir,
      type: "webpage",
      pathOrUrl: "https://wiki.example/x",
      lazy: true,
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(out).not.toMatch(/ignored on lazy sources/);
  });

  it("does NOT warn for --retrieval without --lazy", async () => {
    const out = await captureLogs({
      bundleDir,
      type: "file",
      pathOrUrl: "./README.md",
      retrieval: "hybrid",
      installAfter: false,
    });
    expect(out).not.toMatch(/ignored on lazy sources/);
  });
});
