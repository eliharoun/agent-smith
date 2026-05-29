// tests/io/installed-skills-schema-version.test.ts
//
// B11.3 (v1-task): installed-skills.json gains a `schemaVersion: 1` field
// (renamed from `version: 1`). Mirrors B11.1 / B11.2 migration pattern.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  addInstalledSkill,
  type InstalledSkill,
  loadInstalledSkills,
  removeInstalledSkill,
  saveInstalledSkills,
} from "../../src/io/installed-skills";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "smith-isk-sv-"));
  await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
});
afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

const sampleEntry: InstalledSkill = {
  name: "x",
  sourceCatalogLabel: "example-pack",
  sourcePath: "/tmp/x",
  installedPaths: { opencode: "/tmp/opencode/x" },
  contentHash: "deadbeef",
  installedAt: new Date(0).toISOString(),
};

describe("installed-skills.json schemaVersion [v1-task B11.3]", () => {
  test("loadInstalledSkills returns default with schemaVersion: 1 when missing", async () => {
    const file = await loadInstalledSkills({ homeDir });
    expect(file.schemaVersion).toBe(1);
    expect(file.installed).toEqual([]);
  });

  test("loadInstalledSkills accepts legacy {version: 1, ...} on disk", async () => {
    await Bun.write(
      join(homeDir, ".config/agent-smith/installed-skills.json"),
      JSON.stringify({ version: 1, installed: [sampleEntry] }),
    );
    const file = await loadInstalledSkills({ homeDir });
    expect(file.schemaVersion).toBe(1);
    expect(file.installed).toHaveLength(1);
  });

  test("loadInstalledSkills accepts new {schemaVersion: 1, ...} on disk", async () => {
    await Bun.write(
      join(homeDir, ".config/agent-smith/installed-skills.json"),
      JSON.stringify({ schemaVersion: 1, installed: [sampleEntry] }),
    );
    const file = await loadInstalledSkills({ homeDir });
    expect(file.schemaVersion).toBe(1);
  });

  test("loadInstalledSkills rejects schemaVersion: 2", async () => {
    await Bun.write(
      join(homeDir, ".config/agent-smith/installed-skills.json"),
      JSON.stringify({ schemaVersion: 2, installed: [] }),
    );
    const err = (await loadInstalledSkills({ homeDir }).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("installed-skills-corrupt");
  });

  test("loadInstalledSkills rejects version: 2 (legacy wrong value)", async () => {
    await Bun.write(
      join(homeDir, ".config/agent-smith/installed-skills.json"),
      JSON.stringify({ version: 2, installed: [] }),
    );
    const err = (await loadInstalledSkills({ homeDir }).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("installed-skills-corrupt");
  });

  test("save then load round-trips schemaVersion (writer emits new name)", async () => {
    await saveInstalledSkills({ schemaVersion: 1, installed: [sampleEntry] }, { homeDir });
    const reread = await loadInstalledSkills({ homeDir });
    expect(reread.schemaVersion).toBe(1);
    const raw = await Bun.file(join(homeDir, ".config/agent-smith/installed-skills.json")).json();
    expect(raw.schemaVersion).toBe(1);
    expect(raw.version).toBeUndefined();
  });

  test("addInstalledSkill returns object with schemaVersion: 1", () => {
    const empty = { schemaVersion: 1 as const, installed: [] };
    const next = addInstalledSkill(empty, sampleEntry);
    expect(next.schemaVersion).toBe(1);
    expect(next.installed).toHaveLength(1);
  });

  test("removeInstalledSkill returns object with schemaVersion: 1", () => {
    const start = { schemaVersion: 1 as const, installed: [sampleEntry] };
    const next = removeInstalledSkill(start, "x");
    expect(next.schemaVersion).toBe(1);
    expect(next.installed).toEqual([]);
  });
});
