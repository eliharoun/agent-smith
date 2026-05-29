// tests/io/skill-catalogs-schema-version.test.ts
//
// B11.2 (v1-task): skill-catalogs.json gained a `schemaVersion` field
// (renamed from `version`). Mirrors B11.1's registry.json migration.
//
// C3.7 (v1-task): bumped to `schemaVersion: 2` for the external-repo
// `remote` block on `SkillCatalog`. Loader accepts v1 (with
// `schemaVersion: 1` OR legacy `version: 1`) and v2; writer emits v2.
// v1 inputs are normalized to v2 in memory (the additional `remote`
// field is simply absent).
//
// Coverage:
//   - new files / in-memory constructors carry `schemaVersion: 2`.
//   - legacy on-disk files with `version: 1` parse cleanly (migration).
//   - on-disk files with `schemaVersion: 1` parse cleanly (migration).
//   - on-disk files with `schemaVersion: 2` parse cleanly (current).
//   - explicit wrong values (string `"1"`, future `schemaVersion: 3`,
//     legacy `version: 2`) reject.
//   - save then load round-trips `schemaVersion: 2`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  defaultSkillRegistry,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../../src/io/skill-registry";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-sreg-sv-"));
  path = join(dir, "skill-catalogs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("skill-catalogs.json schemaVersion [v1-tasks B11.2, C3.7]", () => {
  test("defaultSkillRegistry() includes schemaVersion: 2", () => {
    const reg = defaultSkillRegistry();
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadSkillRegistry accepts legacy {version: 1, ...} on disk (migrates to v2 in-memory)", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadSkillRegistry(path);
    expect(reg.schemaVersion).toBe(2);
    // The user-global catalog from the fixture is preserved; atlassian-skills
    // is re-injected as a protected default.
    expect(reg.catalogs.length).toBe(2);
    expect(reg.catalogs.some((c) => c.label === "user-global")).toBe(true);
    expect(reg.catalogs.some((c) => c.label === "atlassian-skills")).toBe(true);
  });

  test("loadSkillRegistry accepts {schemaVersion: 1, ...} on disk (migrates to v2 in-memory)", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        schemaVersion: 1,
        catalogs: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadSkillRegistry(path);
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadSkillRegistry accepts {schemaVersion: 2, ...} on disk", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        schemaVersion: 2,
        catalogs: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadSkillRegistry(path);
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadSkillRegistry rejects schemaVersion: 3 (future)", async () => {
    await Bun.write(path, JSON.stringify({ schemaVersion: 3, catalogs: [] }));
    const err = (await loadSkillRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-version");
  });

  test("loadSkillRegistry rejects schemaVersion as string", async () => {
    await Bun.write(path, JSON.stringify({ schemaVersion: "1", catalogs: [] }));
    const err = (await loadSkillRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-version");
  });

  test("loadSkillRegistry rejects version: 2 (legacy field name only accepts v1)", async () => {
    await Bun.write(path, JSON.stringify({ version: 2, catalogs: [] }));
    const err = (await loadSkillRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-version");
  });

  test("saveSkillRegistry then loadSkillRegistry round-trips schemaVersion: 2", async () => {
    const reg = defaultSkillRegistry();
    await saveSkillRegistry(path, reg);
    const reread = await loadSkillRegistry(path);
    expect(reread.schemaVersion).toBe(2);
    const raw = await Bun.file(path).json();
    expect(raw.schemaVersion).toBe(2);
    expect(raw.version).toBeUndefined();
  });
});
