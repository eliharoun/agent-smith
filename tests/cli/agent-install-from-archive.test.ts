import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import { exportBundle } from "../../src/core/export-bundle";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;
let prevClaudeTier: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-install-archive-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
  prevClaudeTier = process.env.SMITH_CLAUDE_TIER_BALANCED;
  process.env.SMITH_CLAUDE_TIER_BALANCED = "sonnet";
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  if (prevClaudeTier === undefined) delete process.env.SMITH_CLAUDE_TIER_BALANCED;
  else process.env.SMITH_CLAUDE_TIER_BALANCED = prevClaudeTier;
  await rm(home, { recursive: true, force: true });
});

async function seedArchive(): Promise<string> {
  const FIXTURE = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");
  const result = await exportBundle({
    bundlePath: FIXTURE,
    bundleName: "minimal-bundle",
    includeSkills: false,
    userMdPolicy: "stub",
    now: () => new Date("2026-06-04T15:00:00Z"),
    smithVersion: "1.7.0",
  });
  const archivePath = join(home, "minimal.smith-bundle.tgz");
  await writeFile(archivePath, result.archive);
  return archivePath;
}

describe("smith agent install --from <archive>", () => {
  test(
    "routes to the archive importer and registers the catalog",
    async () => {
      const archivePath = await seedArchive();
      await install({
        from: archivePath,
        platformFilter: ["claude-code"],
      });
      // The full install pipeline may not succeed end-to-end in this hermetic env
      // (no claude CLI, no MCP, etc.) but the archive importer must run and the
      // registry should reflect the imported catalog. Inspect the registry.
      const regPath = join(home, "agent-smith", "registry.json");
      const regRaw = await readFile(regPath, "utf8").catch(() => "");
      const reg = JSON.parse(regRaw) as {
        sources: Array<{ kind: string; importedArchive?: { sha256: string } }>;
      };
      const imported = reg.sources.find((s) => s.importedArchive !== undefined);
      expect(imported).toBeDefined();
      expect(imported?.kind).toBe("registered");
      expect(imported?.importedArchive?.sha256).toBeDefined();
    },
    30_000,
  );
});
