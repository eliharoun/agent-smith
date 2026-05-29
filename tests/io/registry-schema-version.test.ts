// tests/io/registry-schema-version.test.ts
//
// B11.1 (v1-task): registry.json gained a `schemaVersion` field (renamed
// from `version`).
//
// C3.6 (v1-task): bumped to `schemaVersion: 2` for the external-repo
// `remote` block. Loader accepts v1 (with `schemaVersion: 1` OR legacy
// `version: 1`) and v2; writer emits v2. v1 inputs are normalized to v2
// in memory (the additional `remote` field is simply absent).
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
import { defaultRegistry, loadRegistry, saveRegistry } from "../../src/io/registry";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-reg-sv-"));
  path = join(dir, "registry.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("registry.json schemaVersion [v1-tasks B11.1, C3.6]", () => {
  test("defaultRegistry() includes schemaVersion: 2", () => {
    const reg = defaultRegistry();
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadRegistry accepts legacy {version: 1, ...} on disk (migrates to v2 in-memory)", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        sources: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadRegistry(path);
    expect(reg.schemaVersion).toBe(2);
    expect(reg.sources).toHaveLength(1);
  });

  test("loadRegistry accepts {schemaVersion: 1, ...} on disk (migrates to v2 in-memory)", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadRegistry(path);
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadRegistry accepts {schemaVersion: 2, ...} on disk", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        schemaVersion: 2,
        sources: [
          {
            kind: "user-global",
            rootPath: "/tmp/x",
            label: "user-global",
          },
        ],
      }),
    );
    const reg = await loadRegistry(path);
    expect(reg.schemaVersion).toBe(2);
  });

  test("loadRegistry rejects schemaVersion: 3 (future)", async () => {
    await Bun.write(path, JSON.stringify({ schemaVersion: 3, sources: [] }));
    const err = (await loadRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-version");
  });

  test("loadRegistry rejects schemaVersion as string", async () => {
    await Bun.write(path, JSON.stringify({ schemaVersion: "1", sources: [] }));
    const err = (await loadRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-version");
  });

  test("loadRegistry rejects version: 2 (legacy field name only accepts v1)", async () => {
    await Bun.write(path, JSON.stringify({ version: 2, sources: [] }));
    const err = (await loadRegistry(path).catch((e: SmithError) => e)) as SmithError;
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-version");
  });

  test("saveRegistry then loadRegistry round-trips schemaVersion: 2", async () => {
    const reg = defaultRegistry();
    await saveRegistry(path, reg);
    const reread = await loadRegistry(path);
    expect(reread.schemaVersion).toBe(2);
    // Writer emits `schemaVersion: 2` only — `version` field must not appear
    // in the persisted form.
    const raw = await Bun.file(path).json();
    expect(raw.schemaVersion).toBe(2);
    expect(raw.version).toBeUndefined();
  });
});
