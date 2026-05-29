// CLI wiring test for: smith skill catalog rename <old> <new>.
//
// Mirrors tests/cli/skill-install.test.ts: mount the subcommand on a fresh
// Commander program with `homeDirOverride` so the registry file lives in a
// temp $HOME, and use `wrapDepsOverride: { rethrow: true }` so the original
// SmithError propagates through `parseAsync(...).catch(e => e)` instead of
// being formatted, printed, and swallowed by `process.exit`.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSkillCatalogCommands } from "../../src/cli/commands/skill/catalog-rename";
import { SmithError } from "../../src/core/smith-error";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-skill-catrename-cli-"));
  await mkdir(join(home, ".config/agent-smith"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command().exitOverride();
  const skill = program.command("skill");
  registerSkillCatalogCommands(skill, {
    homeDirOverride: home,
    wrapDepsOverride: { rethrow: true },
  });
  return program;
}

async function seedRegistry(catalogs: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  await writeFile(
    join(home, ".config/agent-smith/skill-catalogs.json"),
    JSON.stringify({ version: 1, catalogs }),
  );
}

describe("cli/skill catalog rename", () => {
  test("renames an existing catalog label and persists", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([{ kind: "user-local", rootPath: "/tmp/a", label: "old", adhoc: true }]);

    await buildProgram().parseAsync(["skill", "catalog", "rename", "old", "new"], { from: "user" });

    const reg = JSON.parse(
      await readFile(join(home, ".config/agent-smith/skill-catalogs.json"), "utf8"),
    );
    const entry = reg.catalogs.find((c: { rootPath: string }) => c.rootPath === "/tmp/a");
    expect(entry.label).toBe("new");
  });

  test("throws not-found SmithError when oldLabel does not exist", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([]);

    const err = await buildProgram()
      .parseAsync(["skill", "catalog", "rename", "ghost", "new"], { from: "user" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  test("throws already-exists SmithError when newLabel is in use", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([
      { kind: "user-local", rootPath: "/tmp/a", label: "a", adhoc: true },
      { kind: "user-local", rootPath: "/tmp/b", label: "b", adhoc: true },
    ]);

    const err = await buildProgram()
      .parseAsync(["skill", "catalog", "rename", "a", "b"], { from: "user" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("already-exists");
  });

  test("renaming a catalog to its current label is a no-op (no throw, label unchanged)", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    await seedRegistry([{ kind: "user-local", rootPath: "/tmp/a", label: "same", adhoc: true }]);

    await buildProgram().parseAsync(["skill", "catalog", "rename", "same", "same"], {
      from: "user",
    });

    const reg = JSON.parse(
      await readFile(join(home, ".config/agent-smith/skill-catalogs.json"), "utf8"),
    );
    expect(reg.catalogs.find((c: { rootPath: string }) => c.rootPath === "/tmp/a").label).toBe(
      "same",
    );
  });
});
