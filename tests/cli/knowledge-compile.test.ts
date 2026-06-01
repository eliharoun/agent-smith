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
 *
 * `withCompile: true` adds an explicit `compile.progressive` opt-in.
 * `withCompile: false` produces a knowledge block with sources but no
 * `compile` opt-in — `smith knowledge compile` should still force a compile.
 * `withKnowledge: false` produces a bundle with NO `knowledge` block at all,
 * which is the only case `smith knowledge compile` rejects with exit 2.
 */
async function makeBundle(
  agentSmithHome: string,
  name: string,
  opts: { withCompile?: boolean; withKnowledge?: boolean } = {},
): Promise<AgentBundle> {
  const withCompile = opts.withCompile ?? false;
  const withKnowledge = opts.withKnowledge ?? true;
  const bundleDir = join(agentSmithHome, "bundles", name);
  await mkdir(bundleDir, { recursive: true });
  const docPath = join(bundleDir, "doc.md");
  await writeFile(docPath, "# Doc Title\n\nbody body body\n");
  const configRaw: Record<string, unknown> = {
    name,
    description: `Use to test ${name}.`,
    targets: ["opencode"],
    modelTier: "balanced",
    ...(withKnowledge
      ? {
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
            ...(withCompile
              ? { compile: { progressive: true, tocMaxLines: 100, emitAgentsMd: false } }
              : {}),
          },
        }
      : {}),
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

  it("forces compile when bundle has knowledge sources but no compile.progressive opt-in", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    spies.push(warn as unknown as ReturnType<typeof spyOn>);
    // Bundle has a knowledge block + sources but no compile block. v2.1
    // policy: `smith knowledge compile` is a forced compile, not conditional
    // on opt-in or smart-default. The user explicitly asked for it.
    const bundle = await makeBundle(agentSmithHome, "beta", { withCompile: false });
    const code = await runKnowledgeCompile({
      name: "beta",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "beta" ? bundle : null),
    });
    expect(code).toBe(0);
    const manifestPath = compileManifestPath(join(agentSmithHome, "knowledge", "beta"));
    const s = await stat(manifestPath);
    expect(s.isFile()).toBe(true);
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(typeof raw.contentHash).toBe("string");
    expect(raw.contentHash.length).toBeGreaterThan(0);
  });

  it("exits 2 when the bundle has no knowledge block at all", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const errLog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    spies.push(warn as unknown as ReturnType<typeof spyOn>);
    spies.push(errLog as unknown as ReturnType<typeof spyOn>);
    const bundle = await makeBundle(agentSmithHome, "gamma", {
      withKnowledge: false,
    });
    const code = await runKnowledgeCompile({
      name: "gamma",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "gamma" ? bundle : null),
    });
    expect(code).toBe(2);
    const allErr = errLog.mock.calls.flat().map(String).join("\n");
    expect(allErr).toMatch(/no knowledge sources/i);
    // Manifest must NOT be created when there are no sources.
    const manifestPath = compileManifestPath(join(agentSmithHome, "knowledge", "gamma"));
    await expect(stat(manifestPath)).rejects.toThrow();
  });

  it("--all compiles every bundle that has knowledge sources, regardless of compile opt-in", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    spies.push(warn as unknown as ReturnType<typeof spyOn>);
    const explicit = await makeBundle(agentSmithHome, "yes-compile", { withCompile: true });
    const implicit = await makeBundle(agentSmithHome, "no-compile", { withCompile: false });
    const noSources = await makeBundle(agentSmithHome, "no-knowledge", {
      withKnowledge: false,
    });
    const code = await runKnowledgeCompile({
      all: true,
      paths: { agentSmithHome },
      listAllBundles: async () => [explicit, implicit, noSources],
      loadBundle: async (n) => {
        if (n === explicit.config.name) return explicit;
        if (n === implicit.config.name) return implicit;
        if (n === noSources.config.name) return noSources;
        return null;
      },
    });
    // At least one bundle had sources → exit 0. Bundles without a knowledge
    // block are skipped with a one-line warn.
    expect(code).toBe(0);
    // Both bundles with sources get a manifest.
    for (const name of ["yes-compile", "no-compile"]) {
      const manifest = compileManifestPath(join(agentSmithHome, "knowledge", name));
      const s = await stat(manifest);
      expect(s.isFile()).toBe(true);
    }
    // The bundle without knowledge did not get one.
    const skippedManifest = compileManifestPath(
      join(agentSmithHome, "knowledge", "no-knowledge"),
    );
    await expect(stat(skippedManifest)).rejects.toThrow();
  });
});
