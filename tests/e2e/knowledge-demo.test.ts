import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildAndInstall } from "../../src/io/orchestrator";
import { loadBundle } from "../../src/io/bundle-loader";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(here, "../../examples/knowledge-demo");

describe("e2e: knowledge-demo example bundle", () => {
  let oc: string;
  let agentSmithHome: string;

  beforeEach(async () => {
    oc = await mkdtemp(join(tmpdir(), "smith-e2e-kd-"));
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-e2e-as-"));
  });

  afterEach(async () => {
    await rm(oc, { recursive: true, force: true });
    await rm(agentSmithHome, { recursive: true, force: true });
  });

  it("builds and installs with knowledge sections", async () => {
    const bundle = await loadBundle(EXAMPLE_DIR, {
      kind: "user-global",
      rootPath: dirname(EXAMPLE_DIR),
      label: "examples",
    });

    const result = await buildAndInstall(
      [bundle],
      { opencode: oc, "claude-code": oc, codex: oc, kiro: oc },
      {
        knowledgePaths: { agentSmithHome },
        modelResolutionEnv: {
          getOpenCodeModels: async () => undefined,
          warnings: { push: () => {} },
          detectAuthenticatedProviders: async () => ["github-copilot"],
        },
        homeDir: agentSmithHome,
      },
    );

    expect(result.errors).toEqual([]);

    const md = await readFile(join(oc, "knowledge-demo.md"), "utf8");
    expect(md).toContain("## Knowledge");
    expect(md).toContain("CREATE TABLE users");
    expect(md).toContain("## Knowledge Index");
    expect(md).toContain("sources/runbooks/deploy.md");

    const manifest = JSON.parse(
      await readFile(join(agentSmithHome, "knowledge", "knowledge-demo", "_manifest.json"), "utf8"),
    );
    expect(manifest.sources.map((s: { id: string }) => s.id).sort()).toEqual([
      "runbooks",
      "schema",
    ]);
  });
});
