// CLI wiring test for: smith agent catalog rename <old> <new>.
//
// Mirror of tests/cli/skill-catalog-rename.test.ts adapted for the agent
// registry (sources, registry.json). Skips the protected-catalog test
// because agent Source records do not carry a `protected` field today.
//
// Like the skill version, this uses `wrapDepsOverride: { rethrow: true }`
// so the original SmithError propagates out of `parseAsync(...).catch(e => e)`
// instead of being formatted, printed, and swallowed by process.exit.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerAgentCatalogCommands } from "../../src/cli/commands/agent/catalog-rename";
import { SmithError } from "../../src/core/smith-error";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-agent-catrename-cli-"));
  await mkdir(join(home, ".config/agent-smith"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command().exitOverride();
  const agent = program.command("agent");
  registerAgentCatalogCommands(agent, {
    homeDirOverride: home,
    wrapDepsOverride: { rethrow: true },
  });
  return program;
}

async function seedRegistry(
  sources: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    join(home, ".config/agent-smith/registry.json"),
    JSON.stringify({ schemaVersion: 1, sources }),
  );
}

describe("cli/agent catalog rename", () => {
  test("renames an existing catalog label and persists", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([
      { kind: "registered", rootPath: "/tmp/a", label: "old" },
    ]);

    await buildProgram().parseAsync(
      ["agent", "catalog", "rename", "old", "new"],
      { from: "user" },
    );

    const reg = JSON.parse(
      await readFile(join(home, ".config/agent-smith/registry.json"), "utf8"),
    );
    const entry = reg.sources.find(
      (s: { rootPath: string }) => s.rootPath === "/tmp/a",
    );
    expect(entry.label).toBe("new");
  });

  test("throws not-found SmithError when oldLabel does not exist", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([]);

    const err = await buildProgram()
      .parseAsync(["agent", "catalog", "rename", "ghost", "new"], { from: "user" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  test("throws already-exists SmithError when newLabel is in use", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([
      { kind: "registered", rootPath: "/tmp/a", label: "a" },
      { kind: "registered", rootPath: "/tmp/b", label: "b" },
    ]);

    const err = await buildProgram()
      .parseAsync(["agent", "catalog", "rename", "a", "b"], { from: "user" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("already-exists");
  });

  test("renaming a catalog to its current label is a no-op (no throw, label unchanged)", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([
      { kind: "registered", rootPath: "/tmp/a", label: "same" },
    ]);

    await buildProgram().parseAsync(
      ["agent", "catalog", "rename", "same", "same"],
      { from: "user" },
    );

    const reg = JSON.parse(
      await readFile(join(home, ".config/agent-smith/registry.json"), "utf8"),
    );
    expect(
      reg.sources.find((s: { rootPath: string }) => s.rootPath === "/tmp/a").label,
    ).toBe("same");
  });
});
