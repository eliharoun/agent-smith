/**
 * End-to-end CLI coverage for `smith doctor`'s knowledge-compile section
 * and `--fix-knowledge-compile` auto-repair.
 *
 * The detector classifies each registered bundle that opts in to
 * `knowledge.compile.progressive: true` into one of three states:
 *
 *   - missing-manifest: bundle declares progressive compile but
 *                       compile-manifest.json doesn't exist on disk
 *                       (also covers the "corrupt-manifest" case —
 *                       readCompileManifest already returns undefined
 *                       on parse error or schema violation, so we
 *                       conflate the two for v2.0).
 *   - drift:            persisted compile-manifest.contentHash doesn't
 *                       match a fresh compile() over the materialized
 *                       _manifest.json sources.
 *   - clean:            persisted hash matches fresh compile.
 *
 * `--fix-knowledge-compile` re-runs `runKnowledgeCompile({ name })`
 * for every missing-manifest / drift finding to repair the manifest.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import { parseConfig } from "../../src/core/config-schema";
import { runKnowledgeCompile } from "../../src/cli/commands/knowledge/compile";
import {
  compileManifestPath,
  readCompileManifest,
} from "../../src/core/knowledge/compile-manifest";
import type { AgentBundle } from "../../src/core/types";
import type { PlatformId } from "../../src/io/platform-detect";

const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);

interface Ctx {
  root: string;
  agentSmithHome: string;
  bundlesRoot: string;
  schemaCachePath: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-kc-"));
  ctx = {
    root,
    agentSmithHome: join(root, "agent-smith-home"),
    bundlesRoot: join(root, "bundles"),
    schemaCachePath: join(root, "schema-cache.json"),
  };
  await mkdir(ctx.agentSmithHome, { recursive: true });
  await mkdir(ctx.bundlesRoot, { recursive: true });
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

/**
 * Scaffold a bundle on disk with a single file knowledge source. Returns the
 * loaded AgentBundle so tests can hand it to the doctor's bundle loader.
 */
async function makeBundle(
  name: string,
  opts: { withCompile: boolean },
): Promise<AgentBundle> {
  const bundleDir = join(ctx.bundlesRoot, name);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "doc.md"), "# Doc\n\nbody body body\n", "utf8");
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
    source: { kind: "user-global", rootPath: ctx.bundlesRoot, label: "test" },
    bundlePath: bundleDir,
    files: { identity: "", expertise: "", soul: "", user: "" },
  };
}

/** Drive runDoctorCli with the bundles fed in via the test seam.
 *
 * `--fix-knowledge-compile` repair lines are interleaved with `print()`
 * before the final JSON blob; the helper splits them so callers can parse
 * the JSON cleanly.
 */
async function runDoctor(opts: {
  bundles: AgentBundle[];
  fix?: boolean;
}): Promise<{ exitCode: number; stdout: string; report: any }> {
  const lines: string[] = [];
  const code = await runDoctorCli({
    detectInstalledPlatforms: allPlatforms,
    offline: true,
    noCache: false,
    json: true,
    skipModelResolution: true,
    cachePath: ctx.schemaCachePath,
    print: (s: string) => {
      lines.push(s);
    },
    knowledgeCompile: {
      agentSmithHome: ctx.agentSmithHome,
      loadAllBundles: async () => opts.bundles,
    },
    fixKnowledgeCompile: opts.fix === true,
  });
  // The final emitted line is the JSON document; preceding lines are
  // repair-pass progress output.
  const stdout = lines.join("\n");
  const last = lines[lines.length - 1] ?? "";
  let report: any = null;
  try {
    report = last ? JSON.parse(last) : null;
  } catch {
    report = null;
  }
  return { exitCode: code, stdout, report };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("smith doctor knowledge-compile section", () => {
  test("missing-manifest: bundle has compile.progressive but no compile-manifest.json on disk", async () => {
    const bundle = await makeBundle("alpha", { withCompile: true });
    // Note: NO compile-manifest.json scaffolded — the agent's knowledge dir
    // doesn't exist yet either, which is the canonical "compile never ran"
    // state for a freshly registered bundle.
    const { report } = await runDoctor({ bundles: [bundle] });
    expect(report.knowledgeCompile).toBeDefined();
    const f = report.knowledgeCompile.findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "missing-manifest", agent: "alpha" });
  });

  test("drift: manifest exists but hash doesn't match a fresh compile", async () => {
    const bundle = await makeBundle("beta", { withCompile: true });
    // First compile populates the manifest legitimately.
    const code = await runKnowledgeCompile({
      name: "beta",
      paths: { agentSmithHome: ctx.agentSmithHome },
      loadBundle: async (n) => (n === "beta" ? bundle : null),
    });
    expect(code).toBe(0);
    const knowledgeDir = join(ctx.agentSmithHome, "knowledge", "beta");
    const manifestPath = compileManifestPath(knowledgeDir);
    // Mutate the persisted hash so the detector sees drift.
    const persisted = await readCompileManifest(knowledgeDir);
    if (!persisted) throw new Error("expected manifest to exist after compile");
    persisted.contentHash = "deadbeef".repeat(8);
    await writeFile(manifestPath, JSON.stringify(persisted, null, 2), "utf8");

    const { report } = await runDoctor({ bundles: [bundle] });
    const f = report.knowledgeCompile.findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "drift", agent: "beta" });
  });

  test("clean: manifest matches a fresh compile() — no findings", async () => {
    const bundle = await makeBundle("gamma", { withCompile: true });
    const code = await runKnowledgeCompile({
      name: "gamma",
      paths: { agentSmithHome: ctx.agentSmithHome },
      loadBundle: async (n) => (n === "gamma" ? bundle : null),
    });
    expect(code).toBe(0);

    const { report } = await runDoctor({ bundles: [bundle] });
    expect(report.knowledgeCompile.findings).toHaveLength(0);
    expect(report.knowledgeCompile.status).toBe("ok");
  });

  test("bundles without compile.progressive are skipped silently (not flagged missing)", async () => {
    const bundle = await makeBundle("delta", { withCompile: false });
    const { report } = await runDoctor({ bundles: [bundle] });
    // Section runs but produces no findings for non-progressive bundles.
    expect(report.knowledgeCompile.findings).toHaveLength(0);
  });

  test("--fix-knowledge-compile re-runs compile and clears missing-manifest", async () => {
    const bundle = await makeBundle("epsilon", { withCompile: true });
    const knowledgeDir = join(ctx.agentSmithHome, "knowledge", "epsilon");
    const manifestPath = compileManifestPath(knowledgeDir);
    expect(await fileExists(manifestPath)).toBe(false);

    const { report } = await runDoctor({ bundles: [bundle], fix: true });
    // Detection still fires before repair, so the JSON report still shows the
    // pre-repair finding. The on-disk repair is what we assert against.
    expect(report.knowledgeCompile.findings.length).toBeGreaterThan(0);
    expect(await fileExists(manifestPath)).toBe(true);
    const persisted = await readCompileManifest(knowledgeDir);
    expect(persisted).toBeDefined();
    expect(typeof persisted?.contentHash).toBe("string");
  });

  test("--fix-knowledge-compile re-runs compile and clears drift", async () => {
    const bundle = await makeBundle("zeta", { withCompile: true });
    // Seed a real manifest, then corrupt the hash.
    const code = await runKnowledgeCompile({
      name: "zeta",
      paths: { agentSmithHome: ctx.agentSmithHome },
      loadBundle: async (n) => (n === "zeta" ? bundle : null),
    });
    expect(code).toBe(0);
    const knowledgeDir = join(ctx.agentSmithHome, "knowledge", "zeta");
    const manifestPath = compileManifestPath(knowledgeDir);
    const persisted = await readCompileManifest(knowledgeDir);
    if (!persisted) throw new Error("expected manifest to exist");
    const goodHash = persisted.contentHash;
    persisted.contentHash = "f00dface".repeat(8);
    await writeFile(manifestPath, JSON.stringify(persisted, null, 2), "utf8");

    await runDoctor({ bundles: [bundle], fix: true });

    const after = await readCompileManifest(knowledgeDir);
    expect(after).toBeDefined();
    // After --fix the hash is back to the canonical value.
    expect(after?.contentHash).toBe(goodHash);
  });
});
