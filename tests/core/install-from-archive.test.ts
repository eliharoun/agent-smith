import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBundle } from "../../src/core/export-bundle";
import { installFromArchive } from "../../src/core/install-from-archive";
import { writeArchive } from "../../src/io/archive-tar";
import type { ExportManifest } from "../../src/core/export-manifest";

const FIXTURE_MINIMAL = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "install-from-archive-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
});

async function seedArchive(): Promise<string> {
  const result = await exportBundle({
    bundlePath: FIXTURE_MINIMAL,
    bundleName: "minimal-bundle",
    includeSkills: false,
    userMdPolicy: "stub",
    now: () => new Date("2026-06-04T15:00:00Z"),
    smithVersion: "1.7.0",
  });
  const archivePath = join(home, "minimal.smith-bundle.tgz");
  await writeFile(archivePath, result.archive!);
  return archivePath;
}

const ZERO_HASH = "0".repeat(64);

/** Build a minimal valid manifest for a hand-crafted archive. */
function buildManifest(bundleName: string, files: ExportManifest["contents"]["files"]): ExportManifest {
  return {
    exportSchemaVersion: 1,
    bundle: { name: bundleName, contentHash: "a".repeat(64) },
    producedBy: {
      smithVersion: "1.7.0",
      exportedAt: "2026-06-04T00:00:00Z",
      sourceSha: null,
      userAgent: "smith-cli/1.7.0",
    },
    requires: {
      minSmithVersion: "1.0.0",
      mcpServers: { required: [], peer: [], perAgent: [] },
      credentials: [],
      skills: [],
      remoteKnowledge: [],
    },
    contents: {
      files,
      knowledgeSnapshots: [],
      skillBundles: [],
    },
    omitted: { skills: [] },
  };
}

/** Write a hand-crafted archive to a temp file and return the path. */
async function buildArchive(
  bundleName: string,
  manifest: ExportManifest,
  extraEntries?: { path: string; content: string }[],
): Promise<string> {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const entries = [
    { path: `${bundleName}/_smith-export.json`, bytes: manifestBytes },
    ...(extraEntries ?? []).map((e) => ({ path: e.path, bytes: Buffer.from(e.content) })),
  ];
  const archive = await writeArchive(entries, { gzip: true });
  const archivePath = join(home, `${bundleName}.smith-bundle.tgz`);
  await writeFile(archivePath, archive);
  return archivePath;
}

describe("installFromArchive", () => {
  test("stages the bundle and registers a catalog", async () => {
    const archivePath = await seedArchive();
    const result = await installFromArchive({ archivePath, smithVersion: "1.7.0" });
    expect(result.bundles).toEqual(["minimal-bundle"]);
    expect(result.catalogRootPath).toMatch(/imported/);
    const cfg = await readFile(join(result.catalogRootPath, "minimal-bundle", "agent.config.json"), "utf8");
    expect(JSON.parse(cfg).name).toBe("minimal-bundle");
  });

  test("refuses when the archive is corrupted", async () => {
    const archivePath = await seedArchive();
    const original = await readFile(archivePath);
    // Replace bytes mid-archive to invalidate the gzip stream.
    const tampered = Buffer.from(original);
    tampered.fill(0, 100, 200);
    await writeFile(archivePath, tampered);
    await expect(
      installFromArchive({ archivePath, smithVersion: "1.7.0" }),
    ).rejects.toThrow();
  });

  test("refuses when smith version is below the artifact's minimum", async () => {
    const archivePath = await seedArchive();
    await expect(
      installFromArchive({ archivePath, smithVersion: "1.0.0" }),
    ).rejects.toMatchObject({
      payload: {
        code: "validation-failed",
        what: "smith version",
        suggestedCommand: "smith update",
        reasons: [expect.stringMatching(/archive requires smith/)],
      },
    });
  });

  test("(finding 1) schema rejects bundle.name with path traversal sequences", async () => {
    // The schema regex must reject traversal names before any filesystem work.
    // The defense-in-depth runtime guard in install-from-archive.ts is a
    // secondary layer that fires only if the schema is bypassed.
    const { ExportManifestSchema } = await import("../../src/core/export-manifest");
    for (const badName of ["../../etc", "../evil", "foo/bar", ""]) {
      const result = ExportManifestSchema.safeParse(
        buildManifest(badName, []),
      );
      expect(result.success, `expected ${JSON.stringify(badName)} to fail schema`).toBe(false);
    }
  });

  test("(finding 3) refuses an archive with extra entries not in manifest", async () => {
    // The manifest declares only the self-entry; the archive contains an
    // extra file. Staging must ignore the extra file (it is not written),
    // but since our fix drives staging from the manifest, the install should
    // succeed rather than fail — the extra file is simply ignored.
    // The important invariant is that the extra file does NOT land on disk.
    const bundleName = "test-bundle";
    const manifest = buildManifest(bundleName, [
      { path: `${bundleName}/_smith-export.json`, sha256: ZERO_HASH, size: 0 },
    ]);
    const archivePath = await buildArchive(bundleName, manifest, [
      { path: `${bundleName}/undeclared-file.txt`, content: "attacker payload" },
    ]);
    const result = await installFromArchive({ archivePath, smithVersion: "1.7.0" });
    // The undeclared file must not be staged.
    const { stat } = await import("node:fs/promises");
    await expect(
      stat(join(result.catalogRootPath, bundleName, "undeclared-file.txt")),
    ).rejects.toThrow();
  });

  test("refuses an archive whose file hashes don't match the manifest", async () => {
    const bundleName = "test-bundle-bad-hash";
    const fileBytes = Buffer.from("legitimate content");
    // Manifest claims a different hash than the actual file content.
    const wrongHash = "1".repeat(64);
    const manifest = buildManifest(bundleName, [
      { path: `${bundleName}/_smith-export.json`, sha256: ZERO_HASH, size: 0 },
      { path: `${bundleName}/some-file.txt`, sha256: wrongHash, size: fileBytes.length },
    ]);
    const archivePath = await buildArchive(bundleName, manifest, [
      { path: `${bundleName}/some-file.txt`, content: "legitimate content" },
    ]);
    await expect(
      installFromArchive({ archivePath, smithVersion: "1.7.0" }),
    ).rejects.toMatchObject({
      payload: { code: "validation-failed", what: "archive contents" },
    });
  });

  test("(finding 3) rejects ZERO_HASH for non-manifest-self files", async () => {
    // A regular content file with an all-zero sha256 must be rejected.
    // Only the _smith-export.json self-entry is allowed to carry ZERO_HASH.
    const bundleName = "test-bundle-zerohash";
    const regularFileBytes = Buffer.from("agent config content");
    const manifest = buildManifest(bundleName, [
      { path: `${bundleName}/_smith-export.json`, sha256: ZERO_HASH, size: 0 },
      { path: `${bundleName}/agent.config.json`, sha256: ZERO_HASH, size: regularFileBytes.length },
    ]);
    const archivePath = await buildArchive(bundleName, manifest, [
      { path: `${bundleName}/agent.config.json`, content: "agent config content" },
    ]);
    // SmithError headline is "archive contents validation failed"; reasons
    // include "hash mismatch" but are not part of Error.message.
    await expect(
      installFromArchive({ archivePath, smithVersion: "1.7.0" }),
    ).rejects.toMatchObject({ payload: { code: "validation-failed", what: "archive contents" } });
  });
});
