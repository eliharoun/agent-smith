import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { runKnowledgeCompile } from "../../src/cli/commands/knowledge/compile";
import { compileManifestPath } from "../../src/core/knowledge/compile-manifest";
import { parseConfig } from "../../src/core/config-schema";
import type { AgentBundle } from "../../src/core/types";

/**
 * Build an in-memory AgentBundle pointing at an on-disk bundle dir + a single
 * knowledge file source. Returns the bundle and the bundle dir so the caller
 * can clean up.
 */
async function makeBundle(
  agentSmithHome: string,
  name: string,
  opts: { withCompile: boolean },
): Promise<AgentBundle> {
  const bundleDir = join(agentSmithHome, "bundles", name);
  await mkdir(bundleDir, { recursive: true });
  const docPath = join(bundleDir, "doc.md");
  await writeFile(docPath, "# Doc Title\n\nbody body body\n");
  const configRaw: Record<string, unknown> = {
    name,
    description: `Use to test ${name}.`,
    targets: ["opencode"],
    modelTier: "balanced",
    knowledge: {
      sources: [
        {
          id: "doc",
          type: "file",
          path: "./doc.md",
          delivery: "file",
          description: `Doc for ${name}`,
        },
      ],
      ...(opts.withCompile
        ? { compile: { progressive: true, tocMaxLines: 100, emitAgentsMd: false } }
        : {}),
    },
  };
  const parsed = parseConfig(configRaw);
  if (!parsed.success) {
    throw new Error(`fixture invalid: ${parsed.errors.join("; ")}`);
  }
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify(configRaw, null, 2),
  );
  return {
    config: parsed.data,
    source: { kind: "user-global", rootPath: join(agentSmithHome, "bundles"), label: "test" },
    bundlePath: bundleDir,
    files: { identity: "", expertise: "", soul: "", user: "" },
  };
}

describe("smith knowledge compile", () => {
  let agentSmithHome: string;
  const spies: Array<ReturnType<typeof spyOn>> = [];
  beforeEach(async () => {
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-kc-"));
  });
  afterEach(async () => {
    for (const s of spies.splice(0)) s.mockRestore();
    await rm(agentSmithHome, { recursive: true, force: true });
  });

  it("exits 0 and writes compile-manifest.json for a bundle with compile.progressive=true", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const bundle = await makeBundle(agentSmithHome, "alpha", { withCompile: true });
    const code = await runKnowledgeCompile({
      name: "alpha",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "alpha" ? bundle : null),
    });
    expect(code).toBe(0);
    const manifestPath = compileManifestPath(join(agentSmithHome, "knowledge", "alpha"));
    const s = await stat(manifestPath);
    expect(s.isFile()).toBe(true);
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(typeof raw.contentHash).toBe("string");
    expect(raw.contentHash.length).toBeGreaterThan(0);
  });

  it("exits 2 when the agent has no compile block and prints a hint to add one", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const errLog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    spies.push(warn as unknown as ReturnType<typeof spyOn>);
    spies.push(errLog as unknown as ReturnType<typeof spyOn>);
    const bundle = await makeBundle(agentSmithHome, "beta", { withCompile: false });
    const code = await runKnowledgeCompile({
      name: "beta",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "beta" ? bundle : null),
    });
    expect(code).toBe(2);
    const allOut = [
      ...log.mock.calls.flat(),
      ...warn.mock.calls.flat(),
      ...errLog.mock.calls.flat(),
    ]
      .map(String)
      .join("\n");
    expect(allOut).toMatch(/compile\.progressive/);
    // Manifest must NOT be created when compile is absent.
    const manifestPath = compileManifestPath(join(agentSmithHome, "knowledge", "beta"));
    await expect(stat(manifestPath)).rejects.toThrow();
  });

  it("--all walks every registered bundle and exits 0 when at least one had a compile block", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    spies.push(warn as unknown as ReturnType<typeof spyOn>);
    const enabled = await makeBundle(agentSmithHome, "yes-compile", { withCompile: true });
    const skipped = await makeBundle(agentSmithHome, "no-compile", { withCompile: false });
    const code = await runKnowledgeCompile({
      all: true,
      paths: { agentSmithHome },
      listAllBundles: async () => [enabled, skipped],
      loadBundle: async (n) => {
        if (n === enabled.config.name) return enabled;
        if (n === skipped.config.name) return skipped;
        return null;
      },
    });
    // Per the plan: --all exits 0 when at least one had a compile block,
    // skipping the others with a warn.
    expect(code).toBe(0);
    // The compile-enabled agent gets its manifest.
    const enabledManifest = compileManifestPath(
      join(agentSmithHome, "knowledge", "yes-compile"),
    );
    const s = await stat(enabledManifest);
    expect(s.isFile()).toBe(true);
    // The non-compile agent did not get one.
    const skippedManifest = compileManifestPath(
      join(agentSmithHome, "knowledge", "no-compile"),
    );
    await expect(stat(skippedManifest)).rejects.toThrow();
  });
});
