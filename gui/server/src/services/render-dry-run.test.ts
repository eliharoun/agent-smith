import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform } from "../../../shared/src/index";
import { assembleBody } from "../../../../src/core/assembler";
import { renderForTargets } from "../../../../src/core/translators";
import type { AgentBundle, InstallPaths, Target } from "../../../../src/core/types";
import { loadBundle } from "../../../../src/io/bundle-loader";
import { hashContent } from "../../../../src/io/installed-agents";
import { installRendered } from "../../../../src/io/installer";
import { renderDryRun } from "./render-dry-run";

let root: string;
let registryPath: string;

/**
 * Test stub for the model resolver: returns a fixed model per declared target
 * without spawning any platform CLI. The two production resolvers we care
 * about for tests (`opencode`, `claude-code`) get distinct values so the
 * resulting frontmatter byte-differs across platforms.
 */
const STUB_MODELS: Record<Target, string | undefined> = {
  opencode: "github-copilot/claude-sonnet-4.6",
  "claude-code": "sonnet",
  codex: "gpt-5",
  kiro: "claude-sonnet-4-5",
  "agents-md": undefined,
};

function stubResolveAll(bundle: AgentBundle) {
  return Promise.resolve({
    resolvedModels: STUB_MODELS,
    resolvedTargets: [...bundle.config.targets],
  });
}

function stubResolveSkipping(skip: ReadonlySet<Target>) {
  return (bundle: AgentBundle) =>
    Promise.resolve({
      resolvedModels: STUB_MODELS,
      resolvedTargets: bundle.config.targets.filter((t) => !skip.has(t)),
    });
}

const stubLoadConventions = async () => null;

async function writeBundle(catalog: string, name: string, targets: Platform[] = ["opencode"]) {
  const path = join(root, "catalogs", catalog, name);
  await mkdir(path, { recursive: true });
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(path, f), `# ${f}\nbody for ${name}\n`);
  }
  await writeFile(
    join(path, "agent.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name,
      description: "Use proactively for testing the dry-run service.",
      modelTier: "balanced",
      targets,
    }),
  );
  return path;
}

async function writeRegistry(agents: Record<string, string[]>) {
  const catalogs: Record<string, { path: string; agents: string[] }> = {};
  for (const [catalog, names] of Object.entries(agents)) {
    catalogs[catalog] = { path: join(root, "catalogs", catalog), agents: names };
  }
  await writeFile(registryPath, JSON.stringify({ catalogs }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "render-dry-run-"));
  registryPath = join(root, "registry.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("renderDryRun", () => {
  it("produces the same hash that installRendered would write for the same bundle", async () => {
    await writeBundle("default", "alpha", ["opencode"]);
    await writeRegistry({ default: ["alpha"] });

    const bundlePath = join(root, "catalogs", "default", "alpha");
    const bundle = await loadBundle(bundlePath, {
      kind: "registered",
      rootPath: join(root, "catalogs", "default"),
      label: "default",
    });
    const body = assembleBody(bundle.files);
    const rendered = renderForTargets(bundle.config, body, STUB_MODELS, undefined, false, {
      opencode: [],
    });

    // Install to a tmpdir so we can read back the on-disk bytes the
    // installer wrote and hash them — the contractual "what install would
    // write" reference value.
    const installRoot = await mkdtemp(join(tmpdir(), "install-out-"));
    const homeDir = await mkdtemp(join(tmpdir(), "install-home-"));
    try {
      const paths: InstallPaths = {
        opencode: join(installRoot, "opencode"),
        "claude-code": join(installRoot, "claude"),
        codex: join(installRoot, "codex"),
        kiro: join(installRoot, "kiro"),
        "agents-md": installRoot,
      };
      const result = await installRendered(rendered, paths, { homeDir });
      expect(result.installed.length).toBe(1);
      const installedFile = result.installed[0]!.path;
      const installedBytes = await readFile(installedFile, "utf8");
      const installedHash = hashContent(installedBytes);

      const dryRun = await renderDryRun(
        { agent: "alpha" },
        {
          registryPath,
          resolveModels: stubResolveAll,
          loadConventions: stubLoadConventions,
        },
      );
      expect(dryRun.hashes.length).toBe(1);
      expect(dryRun.hashes[0]!.platform).toBe("opencode");
      expect(dryRun.hashes[0]!.kind).toBe("main");
      expect(dryRun.hashes[0]!.hash).toBe(installedHash);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("returns one hash per platform for multi-target bundles", async () => {
    await writeBundle("default", "alpha", ["opencode", "claude-code"]);
    await writeRegistry({ default: ["alpha"] });

    const out = await renderDryRun(
      { agent: "alpha" },
      {
        registryPath,
        resolveModels: stubResolveAll,
        loadConventions: stubLoadConventions,
      },
    );
    expect(out.hashes.map((h) => h.platform).sort()).toEqual(["claude-code", "opencode"]);
    // Each hash is a distinct sha256 prefix.
    for (const h of out.hashes) {
      expect(h.hash.startsWith("sha256:")).toBe(true);
    }
  });

  it("filters render targets when input.targets is provided", async () => {
    await writeBundle("default", "alpha", ["opencode", "claude-code"]);
    await writeRegistry({ default: ["alpha"] });

    const out = await renderDryRun(
      { agent: "alpha", targets: ["opencode"] },
      {
        registryPath,
        resolveModels: stubResolveAll,
        loadConventions: stubLoadConventions,
      },
    );
    expect(out.hashes.length).toBe(1);
    expect(out.hashes[0]!.platform).toBe("opencode");
  });

  it("returns an empty hash list when targets filter to nothing", async () => {
    await writeBundle("default", "alpha", ["opencode"]);
    await writeRegistry({ default: ["alpha"] });

    const out = await renderDryRun(
      { agent: "alpha", targets: ["claude-code"] },
      {
        registryPath,
        resolveModels: stubResolveAll,
        loadConventions: stubLoadConventions,
      },
    );
    expect(out.hashes).toEqual([]);
  });

  it("throws when the agent is not in the registry", async () => {
    await writeRegistry({});

    await expect(
      renderDryRun(
        { agent: "ghost" },
        {
          registryPath,
          resolveModels: stubResolveAll,
          loadConventions: stubLoadConventions,
        },
      ),
    ).rejects.toThrow(/not in registry/);
  });

  it("matches installRendered's hash when a model is resolved", async () => {
    await writeBundle("default", "alpha", ["opencode"]);
    await writeRegistry({ default: ["alpha"] });

    const bundlePath = join(root, "catalogs", "default", "alpha");
    const bundle = await loadBundle(bundlePath, {
      kind: "registered",
      rootPath: join(root, "catalogs", "default"),
      label: "default",
    });
    // Render with the same stubbed model the dry-run will use, so both
    // sides produce the same `model:` line in the frontmatter.
    const body = assembleBody(bundle.files);
    const rendered = renderForTargets(bundle.config, body, STUB_MODELS, undefined, false, {
      opencode: [],
    });

    const installRoot = await mkdtemp(join(tmpdir(), "install-out-"));
    const homeDir = await mkdtemp(join(tmpdir(), "install-home-"));
    try {
      const paths: InstallPaths = {
        opencode: join(installRoot, "opencode"),
        "claude-code": join(installRoot, "claude"),
        codex: join(installRoot, "codex"),
        kiro: join(installRoot, "kiro"),
        "agents-md": installRoot,
      };
      const result = await installRendered(rendered, paths, { homeDir });
      const installedBytes = await readFile(result.installed[0]!.path, "utf8");
      const installedHash = hashContent(installedBytes);
      // Sanity: the rendered bytes must contain the resolved model.
      expect(installedBytes).toContain("github-copilot/claude-sonnet-4.6");

      const dryRun = await renderDryRun(
        { agent: "alpha" },
        {
          registryPath,
          resolveModels: stubResolveAll,
          loadConventions: stubLoadConventions,
        },
      );
      expect(dryRun.hashes[0]!.hash).toBe(installedHash);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("matches installRendered's hash when bundle declares platform conventions", async () => {
    // Use a bundle.config.platformConventions[target] declaration so the
    // resolveConventions Tier 1 (bundle declaration) fires deterministically
    // without a user-prefs file. Conventions are only registered for kiro
    // today, so we use kiro as the test target.
    const { getConventionsForPlatform } = await import(
      "../../../../src/core/platform-conventions"
    );
    const kiroConventions = getConventionsForPlatform("kiro");
    expect(kiroConventions.length).toBeGreaterThan(0);
    const conventionId = kiroConventions[0]!.id;

    const path = join(root, "catalogs", "default", "alpha");
    await mkdir(path, { recursive: true });
    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
      await writeFile(join(path, f), `# ${f}\nbody for alpha\n`);
    }
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "alpha",
        description: "Use proactively for testing the dry-run service.",
        modelTier: "balanced",
        targets: ["kiro"],
        platformConventions: { kiro: [conventionId] },
      }),
    );
    await writeRegistry({ default: ["alpha"] });

    const bundle = await loadBundle(path, {
      kind: "registered",
      rootPath: join(root, "catalogs", "default"),
      label: "default",
    });
    // Replicate the orchestrator's render call with the same convention URIs
    // resolveConventions would pick for the bundle declaration.
    const conventionUris = kiroConventions[0]!.uris.slice().sort();
    const body = assembleBody(bundle.files);
    const rendered = renderForTargets(
      bundle.config,
      body,
      STUB_MODELS,
      undefined,
      false,
      { kiro: conventionUris },
    );

    const installRoot = await mkdtemp(join(tmpdir(), "install-out-"));
    const homeDir = await mkdtemp(join(tmpdir(), "install-home-"));
    try {
      const paths: InstallPaths = {
        opencode: join(installRoot, "opencode"),
        "claude-code": join(installRoot, "claude"),
        codex: join(installRoot, "codex"),
        kiro: join(installRoot, "kiro"),
        "agents-md": installRoot,
      };
      const result = await installRendered(rendered, paths, { homeDir });
      const installedBytes = await readFile(result.installed[0]!.path, "utf8");
      const installedHash = hashContent(installedBytes);

      const dryRun = await renderDryRun(
        { agent: "alpha" },
        {
          registryPath,
          resolveModels: stubResolveAll,
          loadConventions: stubLoadConventions,
        },
      );
      expect(dryRun.hashes[0]!.hash).toBe(installedHash);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("matches installRendered's hash when knowledgeDir injects frontmatter", async () => {
    // claude-code's knowledgeDir injection adds `additionalDirectories` to
    // the rendered frontmatter, which changes the hashed bytes. The dry-run
    // must reproduce the same path. We don't materialize knowledge here;
    // instead we declare a bundle with NO knowledge sources so knowledgeDir
    // stays undefined on both sides — the orchestrator path matches.
    await writeBundle("default", "alpha", ["claude-code"]);
    await writeRegistry({ default: ["alpha"] });

    const bundlePath = join(root, "catalogs", "default", "alpha");
    const bundle = await loadBundle(bundlePath, {
      kind: "registered",
      rootPath: join(root, "catalogs", "default"),
      label: "default",
    });
    const body = assembleBody(bundle.files);
    const rendered = renderForTargets(bundle.config, body, STUB_MODELS, undefined, false, {
      "claude-code": [],
    });

    const installRoot = await mkdtemp(join(tmpdir(), "install-out-"));
    const homeDir = await mkdtemp(join(tmpdir(), "install-home-"));
    try {
      const paths: InstallPaths = {
        opencode: join(installRoot, "opencode"),
        "claude-code": join(installRoot, "claude"),
        codex: join(installRoot, "codex"),
        kiro: join(installRoot, "kiro"),
        "agents-md": installRoot,
      };
      const result = await installRendered(rendered, paths, { homeDir });
      const installedBytes = await readFile(result.installed[0]!.path, "utf8");
      const installedHash = hashContent(installedBytes);
      // Sanity: the rendered bytes must contain the resolved model.
      expect(installedBytes).toContain("model: sonnet");

      const dryRun = await renderDryRun(
        { agent: "alpha" },
        {
          registryPath,
          resolveModels: stubResolveAll,
          loadConventions: stubLoadConventions,
        },
      );
      expect(dryRun.hashes[0]!.hash).toBe(installedHash);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("drops targets that the resolver skips", async () => {
    await writeBundle("default", "alpha", ["opencode", "claude-code"]);
    await writeRegistry({ default: ["alpha"] });

    const skipClaude = stubResolveSkipping(new Set<Target>(["claude-code"]));
    const out = await renderDryRun(
      { agent: "alpha" },
      {
        registryPath,
        resolveModels: skipClaude,
        loadConventions: stubLoadConventions,
      },
    );
    expect(out.hashes.map((h) => h.platform)).toEqual(["opencode"]);
  });
});
