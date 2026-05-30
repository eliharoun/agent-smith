import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { status } from "../../src/cli/commands/status";

describe("smith status — two-section output", () => {
  let dir: string;
  let registryPath: string;
  let skillRegistryPath: string;
  let captured: string[];
  let originalLog: typeof console.log;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-status-test-"));
    registryPath = join(dir, "registry.json");
    skillRegistryPath = join(dir, "skill-catalogs.json");
    captured = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => captured.push(args.join(" "));
  });
  afterEach(async () => {
    console.log = originalLog;
    await rm(dir, { recursive: true, force: true });
  });

  test("prints Agent catalogs section", async () => {
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", rootPath: "/agents", label: "user-global" }],
      }),
    );
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    await status({ registryPath, skillRegistryPath });
    const output = captured.join("\n");
    expect(output).toMatch(/Agent catalogs \(1\)/);
    expect(output).toMatch(/\[user-global\]/);
    expect(output).toMatch(/\/agents/);
  });

  test("prints Skill catalogs section with flags", async () => {
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, sources: [] }));
    await writeFile(
      skillRegistryPath,
      JSON.stringify({
        version: 1,
        catalogs: [
          {
            kind: "team-shared",
            rootPath: "/atlassian-skills",
            label: "atlassian-skills",
            protected: true,
          },
          { kind: "user-local", rootPath: "/skills", label: "my-skills" },
        ],
      }),
    );
    await status({ registryPath, skillRegistryPath });
    const output = captured.join("\n");
    expect(output).toMatch(/Skill catalogs \(2\)/);
    expect(output).toMatch(/\[team-shared\]/);
    expect(output).toMatch(/\[user-local\]/);
    expect(output).toMatch(/protected/);
  });

  test("prints (none) for empty agent registry; skill registry shows atlassian-skills when empty on disk", async () => {
    // Even with an empty on-disk catalogs array, loadSkillRegistry re-injects
    // the protected atlassian-skills catalog.
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, sources: [] }));
    await writeFile(skillRegistryPath, JSON.stringify({ version: 1, catalogs: [] }));
    await status({ registryPath, skillRegistryPath });
    const output = captured.join("\n");
    expect(output).toMatch(/Agent catalogs \(0\)/);
    expect(output).toMatch(/Skill catalogs \(1\)/);
    expect(output).toMatch(/atlassian-skills/);
  });

  test("status accepts default paths when called with no args", async () => {
    // Smoke test: no throw when paths arg omitted (uses canonical paths).
    // This test is loose — it just ensures the signature still works with
    // no args. Don't assert on output.
    await status();
    expect(true).toBe(true);
  });
});
