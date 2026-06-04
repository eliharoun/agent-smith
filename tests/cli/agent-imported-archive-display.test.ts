import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runListCli } from "../../src/cli/commands/list";
import { agentCatalogs } from "../../src/cli/commands/agent/catalogs";
import { runAgentSync } from "../../src/cli/commands/agent/sync";
import { exportBundle } from "../../src/core/export-bundle";
import { installFromArchive } from "../../src/core/install-from-archive";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;
let prevClaudeTier: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "imported-archive-display-"));
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

async function seedImportedCatalog(): Promise<{ archivePath: string; label: string }> {
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
  await installFromArchive({ archivePath, smithVersion: "1.7.0" });
  return { archivePath, label: "imported/minimal-bundle" };
}

describe("imported-archive catalog display", () => {
  test("smith agent catalogs annotates imported-archive sources", async () => {
    await seedImportedCatalog();
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await agentCatalogs();
    } finally {
      console.log = origLog;
    }
    const out = lines.join("\n");
    expect(out).toMatch(/imported-archive/);
  });

  test("smith agent list shows the imported-archive kind for imported catalogs", async () => {
    await seedImportedCatalog();
    const lines: string[] = [];
    await runListCli({
      print: (m) => lines.push(m),
      printErr: () => {},
    });
    const out = lines.join("\n");
    expect(out).toMatch(/imported-archive/);
  });

  test("smith agent sync prints an advisory and exits 0 for imported-archive catalogs", async () => {
    const { label } = await seedImportedCatalog();
    const errLines: string[] = [];
    const outLines: string[] = [];
    const code = await runAgentSync({
      name: label,
      print: (m) => outLines.push(m),
      printErr: (m) => errLines.push(m),
    });
    expect(code).toBe(0);
    const all = [...outLines, ...errLines].join("\n");
    expect(all).toMatch(/imported from archive/);
    expect(all).toMatch(/install --from/);
  });
});
