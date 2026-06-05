import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform } from "gui-shared";
import { assembleBody } from "../../../../src/core/assembler";
import { renderForTargets } from "../../../../src/core/translators";
import type { InstallPaths } from "../../../../src/core/types";
import { loadBundle } from "../../../../src/io/bundle-loader";
import { hashContent } from "../../../../src/io/installed-agents";
import { installRendered } from "../../../../src/io/installer";
import { renderDryRun } from "./render-dry-run";

let root: string;
let registryPath: string;

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
    const rendered = renderForTargets(bundle.config, body, {
      opencode: undefined,
      "claude-code": undefined,
      codex: undefined,
      kiro: undefined,
      "agents-md": undefined,
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

      const dryRun = await renderDryRun({ agent: "alpha" }, { registryPath });
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

    const out = await renderDryRun({ agent: "alpha" }, { registryPath });
    expect(out.hashes.map((h) => h.platform).sort()).toEqual(["claude-code", "opencode"]);
    // Each hash is a distinct sha256 prefix.
    for (const h of out.hashes) {
      expect(h.hash.startsWith("sha256:")).toBe(true);
    }
  });

  it("filters render targets when input.targets is provided", async () => {
    await writeBundle("default", "alpha", ["opencode", "claude-code"]);
    await writeRegistry({ default: ["alpha"] });

    const out = await renderDryRun({ agent: "alpha", targets: ["opencode"] }, { registryPath });
    expect(out.hashes.length).toBe(1);
    expect(out.hashes[0]!.platform).toBe("opencode");
  });

  it("returns an empty hash list when targets filter to nothing", async () => {
    await writeBundle("default", "alpha", ["opencode"]);
    await writeRegistry({ default: ["alpha"] });

    const out = await renderDryRun({ agent: "alpha", targets: ["claude-code"] }, { registryPath });
    expect(out.hashes).toEqual([]);
  });

  it("throws when the agent is not in the registry", async () => {
    await writeRegistry({});

    await expect(renderDryRun({ agent: "ghost" }, { registryPath })).rejects.toThrow(
      /not in registry/,
    );
  });
});
