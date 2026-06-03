import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { runKnowledgeCompile } from "../../src/cli/commands/knowledge/compile";
import { compileManifestPath } from "../../src/core/knowledge/compile-manifest";
import { parseConfig } from "../../src/core/config-schema";
import { McpClientPool } from "../../src/io/mcp-client-pool";
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

/**
 * Build a bundle with a single URL knowledge source. `via` attaches a
 * routing override so the compile path resolves through the MCP pool.
 */
async function makeRoutedBundle(
  agentSmithHome: string,
  name: string,
  opts: { url?: string; via?: { server: string; tool: string } } = {},
): Promise<AgentBundle> {
  const url = opts.url ?? "https://example.com/doc";
  const bundleDir = join(agentSmithHome, "bundles", name);
  await mkdir(bundleDir, { recursive: true });
  const sourceEntry: Record<string, unknown> = {
    id: "via-src",
    type: "url",
    url,
    delivery: "file",
    description: `Routed source for ${name}`,
  };
  if (opts.via) sourceEntry.via = opts.via;
  const configRaw: Record<string, unknown> = {
    name,
    description: `Use to test ${name}.`,
    targets: ["opencode"],
    modelTier: "balanced",
    knowledge: {
      sources: [sourceEntry],
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

  // ============================================================
  // v1.4.4: MCP routing wired into compile (mirrors fetch.ts)
  // ============================================================

  it("compiles a bundle with a routed (via:) source", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const ECHO_FIXTURE = join(import.meta.dir, "..", "_fixtures", "echo-mcp-server.ts");
    const bundle = await makeRoutedBundle(agentSmithHome, "via-ok", {
      url: "https://example.com/x",
      via: { server: "echo", tool: "Fetch" },
    });
    const readAvailable = mock(async () => ({
      echo: { command: "bun", args: [ECHO_FIXTURE] },
    }));
    const code = await runKnowledgeCompile({
      name: "via-ok",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "via-ok" ? bundle : null),
      readAvailableMcpServers: readAvailable,
      // Skip persisting routing cache to disk during the test.
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      saveRouteCache: async () => {},
      isTTY: () => false,
    });
    expect(code).toBe(0);
    const manifestPath = compileManifestPath(join(agentSmithHome, "knowledge", "via-ok"));
    const s = await stat(manifestPath);
    expect(s.isFile()).toBe(true);
    // The materialized artifact should contain the echoed URL, proving the
    // request went through the echo MCP server (not direct HTTP).
    const sourcesDir = join(agentSmithHome, "knowledge", "via-ok", "sources", "via-src");
    const entries = await readdir(sourcesDir);
    expect(entries.length).toBeGreaterThan(0);
    const firstFile = entries[0];
    if (!firstFile) throw new Error("no materialized artifact");
    const body = await readFile(join(sourcesDir, firstFile), "utf8");
    expect(body).toContain("example.com");
  }, 30_000);

  it("throws clearly when via.server isn't configured", async () => {
    const errLog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errLog as unknown as ReturnType<typeof spyOn>);
    const bundle = await makeRoutedBundle(agentSmithHome, "via-missing", {
      url: "https://example.com/x",
      via: { server: "ghost", tool: "Fetch" },
    });
    const readAvailable = mock(async () => ({}));
    const code = await runKnowledgeCompile({
      name: "via-missing",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "via-missing" ? bundle : null),
      readAvailableMcpServers: readAvailable,
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      saveRouteCache: async () => {},
      isTTY: () => false,
    });
    // Acquire-failure is surfaced as exit 1 (pipeline.errors path) and the
    // error includes the missing server name so the user knows what to fix.
    expect(code).toBe(1);
    const allErr = errLog.mock.calls.flat().map(String).join("\n");
    expect(allErr).toContain("ghost");
  }, 15_000);

  it("non-TTY skips the probe path entirely", async () => {
    const errLog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errLog as unknown as ReturnType<typeof spyOn>);
    // URL source with NO via:. With probe disabled (non-TTY), direct HTTP is
    // the only resolver path; localhost:1 must fail cleanly without prompting.
    const bundle = await makeRoutedBundle(agentSmithHome, "no-tty", {
      url: "http://127.0.0.1:1/never-listens",
    });
    const readAvailable = mock(async () => ({}));
    const code = await runKnowledgeCompile({
      name: "no-tty",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "no-tty" ? bundle : null),
      readAvailableMcpServers: readAvailable,
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      saveRouteCache: async () => {},
      isTTY: () => false,
    });
    expect(code).toBe(1);
    // We get a real failure message, not a hang on stdin.
    const allErr = errLog.mock.calls.flat().map(String).join("\n");
    expect(allErr.length).toBeGreaterThan(0);
  }, 15_000);

  it("pool shuts down even on error", async () => {
    const errLog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errLog as unknown as ReturnType<typeof spyOn>);
    const pool = new McpClientPool();
    const shutdownSpy = spyOn(pool, "shutdown");
    spies.push(shutdownSpy as unknown as ReturnType<typeof spyOn>);
    // Force an error by referencing an unconfigured `via.server`. The
    // pipeline surfaces it as a per-source error and we still expect
    // shutdown() to fire from the finally block.
    const bundle = await makeRoutedBundle(agentSmithHome, "pool-err", {
      url: "https://example.com/y",
      via: { server: "ghost", tool: "Fetch" },
    });
    const code = await runKnowledgeCompile({
      name: "pool-err",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "pool-err" ? bundle : null),
      readAvailableMcpServers: async () => ({}),
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      saveRouteCache: async () => {},
      isTTY: () => false,
      pool,
    });
    expect(code).toBe(1);
    expect(shutdownSpy).toHaveBeenCalled();
  }, 15_000);
});
