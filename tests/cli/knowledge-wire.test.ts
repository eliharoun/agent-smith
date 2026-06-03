import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeWire } from "../../src/cli/commands/knowledge/wire";
import { parseConfig } from "../../src/core/config-schema";
import { SmithError } from "../../src/core/smith-error";
import type { AgentBundle } from "../../src/core/types";
import type { McpPlatform } from "../../src/io/mcp-wiring";

/**
 * `smith knowledge wire/unwire` — end-to-end CLI flow tests with a tempdir
 * standing in for $HOME. Every input is injected (loadBundle, paths,
 * detectInstalled, resolveSmithPath) so the tests never touch real $HOME
 * or shared state.
 */

let root: string;

async function makeBundle(name: string): Promise<AgentBundle> {
  const bundleDir = join(root, "bundles", name);
  await mkdir(bundleDir, { recursive: true });
  const config: Record<string, unknown> = {
    name,
    description: `Use to test ${name}.`,
    targets: ["opencode"],
    modelTier: "balanced",
  };
  await writeFile(join(bundleDir, "agent.config.json"), JSON.stringify(config, null, 2));
  const parsed = parseConfig(config);
  if (!parsed.success) throw new Error(`fixture invalid: ${parsed.errors.join("; ")}`);
  return {
    config: parsed.data,
    source: { kind: "user-global", rootPath: join(root, "bundles"), label: "test" },
    bundlePath: bundleDir,
    files: { identity: "", expertise: "", soul: "", user: "" },
  };
}

function tempPaths(): Record<McpPlatform, string> {
  return {
    "claude-code": join(root, ".claude.json"),
    opencode: join(root, ".config", "opencode", "opencode.json"),
    codex: join(root, ".codex", "config.toml"),
    kiro: join(root, ".kiro", "settings", "mcp.json"),
  };
}

const fakeSmithPath = "/abs/smith";
const allInstalled = (): Promise<Set<McpPlatform>> =>
  Promise.resolve(new Set(["opencode", "claude-code", "codex", "kiro"] as McpPlatform[]));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smith-wire-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("smith knowledge wire", () => {
  it("writes the per-agent key to every detected platform's config file", async () => {
    const bundle = await makeBundle("alpha");
    const paths = tempPaths();

    const result = await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "alpha" ? bundle : null),
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.bundleUpdated).toBe(true);
    // Every platform should have written.
    const wrote = result.perPlatform.filter((p) => p.status === "wrote");
    expect(wrote.length).toBe(4);

    const cc = JSON.parse(await readFile(paths["claude-code"], "utf8"));
    expect(cc.mcpServers["alpha-knowledge"]).toEqual({
      command: fakeSmithPath,
      args: ["knowledge", "serve", "alpha", "--stdio"],
    });
    const oc = JSON.parse(await readFile(paths.opencode, "utf8"));
    expect(oc.mcp["alpha-knowledge"]).toBeDefined();
    const kr = JSON.parse(await readFile(paths.kiro, "utf8"));
    expect(kr.mcpServers["alpha-knowledge"]).toBeDefined();
  });

  it("two agents wired in sequence: BOTH keys present, no clobber", async () => {
    const a = await makeBundle("agent-smith");
    const b = await makeBundle("my-agent");
    const paths = tempPaths();

    const r1 = await runKnowledgeWire({
      agent: "agent-smith",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "agent-smith" ? a : null),
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    expect(r1.exitCode).toBe(0);

    const r2 = await runKnowledgeWire({
      agent: "my-agent",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "my-agent" ? b : null),
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    expect(r2.exitCode).toBe(0);

    const cc = JSON.parse(await readFile(paths["claude-code"], "utf8"));
    // BOTH keys present — no clobber.
    expect(cc.mcpServers["agent-smith-knowledge"]).toBeDefined();
    expect(cc.mcpServers["my-agent-knowledge"]).toBeDefined();
    expect(cc.mcpServers["agent-smith-knowledge"].args).toEqual([
      "knowledge", "serve", "agent-smith", "--stdio",
    ]);
    expect(cc.mcpServers["my-agent-knowledge"].args).toEqual([
      "knowledge", "serve", "my-agent", "--stdio",
    ]);
  });

  it("unwire <agent> only removes that agent's key, leaves other entries", async () => {
    const a = await makeBundle("agent-smith");
    const b = await makeBundle("my-agent");
    const paths = tempPaths();

    // Wire both agents first.
    await runKnowledgeWire({
      agent: "agent-smith",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "agent-smith" ? a : null),
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    await runKnowledgeWire({
      agent: "my-agent",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "my-agent" ? b : null),
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });

    // Unwire just agent-smith.
    const r = await runKnowledgeWire({
      agent: "agent-smith",
      mode: "unwire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async (n) => (n === "agent-smith" ? a : null),
      log: () => {},
      err: () => {},
    });
    expect(r.exitCode).toBe(0);

    const cc = JSON.parse(await readFile(paths["claude-code"], "utf8"));
    expect(cc.mcpServers["agent-smith-knowledge"]).toBeUndefined();
    // Other agent's entry preserved.
    expect(cc.mcpServers["my-agent-knowledge"]).toBeDefined();
  });

  it("idempotent: wiring already-wired is a no-op (exit 0, status 'no-change')", async () => {
    const bundle = await makeBundle("alpha");
    const paths = tempPaths();

    await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async () => bundle,
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    const before = await readFile(paths["claude-code"], "utf8");

    const r = await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async () => bundle,
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    expect(r.exitCode).toBe(0);
    // Every platform is already wired, so all entries are "no-change".
    expect(r.perPlatform.every((p) => p.status === "no-change")).toBe(true);
    // Bundle's mcpServers[] already has the key — second call doesn't rewrite.
    expect(r.bundleUpdated).toBe(false);
    const after = await readFile(paths["claude-code"], "utf8");
    expect(after).toBe(before);
  });

  it("unknown agent: throws SmithError with code 'not-found'", async () => {
    let caught: unknown;
    try {
      await runKnowledgeWire({
        agent: "ghost",
        mode: "wire",
        paths: tempPaths(),
        detectInstalled: allInstalled,
        loadBundle: async () => null,
        resolveSmithPath: () => fakeSmithPath,
        log: () => {},
        err: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("not-found");
  });

  it("--platforms claude-code: only writes the claude config", async () => {
    const bundle = await makeBundle("alpha");
    const paths = tempPaths();

    const r = await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      platforms: "claude-code",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async () => bundle,
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    expect(r.exitCode).toBe(0);
    const wrote = r.perPlatform.filter((p) => p.status === "wrote");
    expect(wrote.map((p) => p.platform)).toEqual(["claude-code"]);
    // The other config files were never created.
    expect(await Bun.file(paths.opencode).exists()).toBe(false);
    expect(await Bun.file(paths.kiro).exists()).toBe(false);
    expect(await Bun.file(paths.codex).exists()).toBe(false);
  });

  it("wire updates the bundle's agent.config.json mcpServers[]", async () => {
    const bundle = await makeBundle("alpha");
    const paths = tempPaths();

    await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      paths,
      detectInstalled: allInstalled,
      loadBundle: async () => bundle,
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });

    const onDisk = JSON.parse(
      await readFile(join(bundle.bundlePath, "agent.config.json"), "utf8"),
    ) as { mcpServers?: string[] };
    expect(onDisk.mcpServers).toEqual(["alpha-knowledge"]);
  });

  it("skips platforms whose CLI is not detected, with no error", async () => {
    const bundle = await makeBundle("alpha");
    const paths = tempPaths();

    const r = await runKnowledgeWire({
      agent: "alpha",
      mode: "wire",
      paths,
      detectInstalled: async () => new Set(["claude-code"] as McpPlatform[]),
      loadBundle: async () => bundle,
      resolveSmithPath: () => fakeSmithPath,
      log: () => {},
      err: () => {},
    });
    expect(r.exitCode).toBe(0);
    const wrote = r.perPlatform.filter((p) => p.status === "wrote");
    expect(wrote.map((p) => p.platform)).toEqual(["claude-code"]);
    const skipped = r.perPlatform.filter((p) => p.status === "skipped-cli-missing");
    expect(skipped.map((p) => p.platform).sort()).toEqual(["codex", "kiro", "opencode"]);
  });
});
