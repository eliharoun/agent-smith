import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeCompile } from "../../../src/cli/commands/knowledge/compile";
import { readCompileManifest } from "../../../src/core/knowledge/compile-manifest";
import type { AgentBundle } from "../../../src/core/types";

let root: string;
let agentSmithHome: string;
let bundleDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "drift-"));
  agentSmithHome = join(root, "smith-home");
  bundleDir = join(root, "bundle");
  await mkdir(bundleDir, { recursive: true });
  await mkdir(join(agentSmithHome, "knowledge", "alpha", "sources", "wiki"), { recursive: true });
  // Materialize a tiny file so the manifest has a non-empty sources entry.
  await writeFile(
    join(agentSmithHome, "knowledge", "alpha", "sources", "wiki", "page.md"),
    "# stub\n",
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("knowledge compile drift — lazy URL hash convergence", () => {
  it("CLI compile and doctor's fresh recompute produce the same hash for bundles with lazy URL sources", async () => {
    // Pre-populate _manifest.json the way `smith knowledge fetch` would,
    // for a bundle whose `agent.config.json` declares a lazy URL source.
    const manifest = {
      schemaVersion: 1,
      renderedAt: new Date(0).toISOString(),
      sources: [
        {
          id: "wiki",
          scope: "agent" as const,
          type: "url" as const,
          source: { url: "https://example.com/wiki" },
          delivery: "file" as const,
          files: [
            {
              path: "sources/wiki/page.md",
              sha256: "a".repeat(64),
              bytes: 7,
              summary: "stub",
            },
          ],
          fetchedAt: "2026-01-01T00:00:00Z",
          extractor: null,
          tokensInline: 0,
          description: "wiki page",
        },
      ],
      totals: { tokensInline: 0, tokensInlineBudget: 0, files: 1, bytes: 7 },
    };
    await writeFile(
      join(agentSmithHome, "knowledge", "alpha", "_manifest.json"),
      JSON.stringify(manifest),
    );

    const bundle: AgentBundle = {
      config: {
        schemaVersion: 1,
        name: "alpha",
        targets: ["claude-code"],
        modelTier: "balanced",
        description: "stub",
        knowledge: {
          sources: [
            {
              id: "wiki",
              type: "url",
              url: "https://example.com/wiki",
              delivery: "auto",
              lazy: true,
              description: "wiki page",
            },
          ],
          compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
        },
      },
      bundlePath: bundleDir,
      source: { kind: "user-global", rootPath: bundleDir, label: "test" },
      files: { identity: "", expertise: "", soul: "", user: "" },
    };

    // Run the CLI compile path
    const code = await runKnowledgeCompile({
      name: "alpha",
      paths: { agentSmithHome },
      loadBundle: async (n) => (n === "alpha" ? bundle : null),
    });
    expect(code).toBe(0);

    const cliManifest = await readCompileManifest(
      join(agentSmithHome, "knowledge", "alpha"),
    );
    expect(cliManifest).toBeDefined();
    const cliHash = cliManifest!.contentHash;

    // Now invoke the doctor's drift detector candidate path manually:
    // build the same compileOptions shape doctor.ts:486-498 builds, and
    // run compile() directly to compute its "fresh" hash.
    const { compile } = await import("../../../src/core/knowledge/compile");
    const { buildCompileOptionsFromBundle } = await import(
      "../../../src/core/knowledge/compile-options"
    );
    const matSources = manifest.sources.map((s) => ({
      id: s.id,
      scope: s.scope,
      type: s.type,
      delivery: s.delivery,
      files: s.files.map((f) => ({
        relPath: f.path,
        bytes: f.bytes,
        sha256: f.sha256,
        ...(f.summary ? { summary: f.summary } : {}),
      })),
      tokensInline: s.tokensInline,
      ...(s.description ? { description: s.description } : {}),
      ...(s.source ? { source: s.source } : {}),
      ...(s.fetchedAt ? { fetchedAt: s.fetchedAt } : {}),
    }));
    const opts = buildCompileOptionsFromBundle(bundle.config.knowledge);
    const fresh = compile(matSources, opts, {
      rootDir: join(agentSmithHome, "knowledge", "alpha"),
    });
    expect(fresh.manifest.contentHash).toBe(cliHash);
  });
});
