import { describe, expect, test } from "bun:test";
import {
  ExportManifestSchema,
  manifestToReadme,
  type ExportManifest,
} from "../../src/core/export-manifest";

const VALID: ExportManifest = {
  exportSchemaVersion: 1,
  bundle: { name: "code-reviewer", contentHash: "a".repeat(64) },
  producedBy: {
    smithVersion: "1.7.0",
    exportedAt: "2026-06-03T15:00:00Z",
    sourceSha: null,
    userAgent: "smith-cli/1.7.0 (darwin)",
  },
  requires: {
    minSmithVersion: "1.7.0",
    mcpServers: { required: [], peer: [], perAgent: [] },
    credentials: [],
    skills: [],
    remoteKnowledge: [],
  },
  contents: { files: [], knowledgeSnapshots: [], skillBundles: [] },
  omitted: { skills: [] },
};

describe("ExportManifestSchema", () => {
  test("accepts a minimal valid manifest", () => {
    expect(ExportManifestSchema.parse(VALID)).toEqual(VALID);
  });

  test("rejects exportSchemaVersion != 1", () => {
    expect(() =>
      ExportManifestSchema.parse({ ...VALID, exportSchemaVersion: 2 }),
    ).toThrow();
  });

  test("rejects content hash that isn't 64 hex chars", () => {
    expect(() =>
      ExportManifestSchema.parse({
        ...VALID,
        bundle: { ...VALID.bundle, contentHash: "short" },
      }),
    ).toThrow();
  });

  test("rejects bundle.name with path traversal sequences", () => {
    // A traversal name would escape the catalog root when used in path.join;
    // the schema must reject these before any filesystem operations occur.
    for (const badName of ["../../etc", "../evil", "foo/bar", "foo\\bar", ""]) {
      const result = ExportManifestSchema.safeParse({
        ...VALID,
        bundle: { ...VALID.bundle, name: badName },
      });
      expect(result.success, `expected ${JSON.stringify(badName)} to fail`).toBe(false);
    }
  });

  test("accepts valid kebab-case bundle names", () => {
    for (const goodName of ["a", "my-agent", "code-reviewer", "agent-1", "a".repeat(64)]) {
      const result = ExportManifestSchema.safeParse({
        ...VALID,
        bundle: { ...VALID.bundle, name: goodName },
      });
      expect(result.success, `expected ${JSON.stringify(goodName)} to pass`).toBe(true);
    }
  });

  test("rejects non-semver minSmithVersion", () => {
    expect(() =>
      ExportManifestSchema.parse({
        ...VALID,
        requires: { ...VALID.requires, minSmithVersion: "garbage" },
      }),
    ).toThrow();
  });
});

describe("manifestToReadme", () => {
  test("includes bundle name and smith install command", () => {
    const md = manifestToReadme(VALID);
    expect(md).toContain("code-reviewer");
    expect(md).toContain("smith agent install --from");
  });

  test("lists required MCP servers when present", () => {
    const md = manifestToReadme({
      ...VALID,
      requires: {
        ...VALID.requires,
        mcpServers: { required: ["internal-mcp"], peer: [], perAgent: [] },
      },
    });
    expect(md).toMatch(/internal-mcp/);
    expect(md).toMatch(/MCP server/);
  });

  test("lists remote knowledge when present", () => {
    const md = manifestToReadme({
      ...VALID,
      requires: {
        ...VALID.requires,
        remoteKnowledge: [{ id: "wiki", type: "url", endpoint: "wiki.example.com" }],
      },
    });
    expect(md).toMatch(/wiki\.example\.com/);
    expect(md).toMatch(/fetched at install/);
  });
});
