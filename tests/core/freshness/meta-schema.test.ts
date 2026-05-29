import { describe, expect, test } from "bun:test";
import { parseSchemaMeta, parseToolMapMeta } from "../../../src/core/freshness/meta-schema";

describe("parseToolMapMeta", () => {
  test("accepts a valid tool-map _meta block", () => {
    const meta = parseToolMapMeta({
      lastVerifiedDate: "2026-04-20",
      verifiedAgainstVersion: "claude-code v0.42.0",
      sourceUrl: "https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools",
      notes: "Verified by hand.",
    });
    expect(meta.lastVerifiedDate).toBe("2026-04-20");
    expect(meta.verifiedAgainstVersion).toBe("claude-code v0.42.0");
  });

  test("rejects a malformed date", () => {
    expect(() =>
      parseToolMapMeta({
        lastVerifiedDate: "April 20, 2026",
        verifiedAgainstVersion: "x",
        sourceUrl: "https://example.com",
        notes: "",
      }),
    ).toThrow(/lastVerifiedDate/);
  });

  test("rejects missing fields", () => {
    expect(() =>
      parseToolMapMeta({ lastVerifiedDate: "2026-04-20", sourceUrl: "https://x" }),
    ).toThrow(/verifiedAgainstVersion|notes/);
  });

  test("rejects a non-https sourceUrl", () => {
    expect(() =>
      parseToolMapMeta({
        lastVerifiedDate: "2026-04-20",
        verifiedAgainstVersion: "x",
        sourceUrl: "ftp://example.com",
        notes: "",
      }),
    ).toThrow(/sourceUrl/);
  });

  test("rejects empty verifiedAgainstVersion", () => {
    expect(() =>
      parseToolMapMeta({
        lastVerifiedDate: "2026-04-20",
        verifiedAgainstVersion: "",
        sourceUrl: "https://example.com",
        notes: "",
      }),
    ).toThrow(/verifiedAgainstVersion/);
  });

  test("rejects an impossible calendar date", () => {
    expect(() =>
      parseToolMapMeta({
        lastVerifiedDate: "2026-02-31",
        verifiedAgainstVersion: "x",
        sourceUrl: "https://example.com",
        notes: "",
      }),
    ).toThrow(/lastVerifiedDate/);
  });

  test("rejects unknown keys (strict mode catches typos)", () => {
    expect(() =>
      parseToolMapMeta({
        lastVerifiedDate: "2026-04-20",
        verifiedAgainstVersion: "x",
        sourceUrl: "https://example.com",
        notes: "",
        notesz: "typo",
      }),
    ).toThrow();
  });
});

describe("parseSchemaMeta", () => {
  test("accepts a valid schema _meta block (with nullable schemaId/version)", () => {
    const meta = parseSchemaMeta({
      lastVerifiedDate: "2026-05-01",
      sourceUrl: "https://opencode.ai/config.json",
      schemaId: null,
      version: null,
      notes: "Refreshed.",
    });
    expect(meta.schemaId).toBeNull();
    expect(meta.version).toBeNull();
  });

  test("accepts non-null schemaId and version", () => {
    const meta = parseSchemaMeta({
      lastVerifiedDate: "2026-05-01",
      sourceUrl: "https://opencode.ai/config.json",
      schemaId: "https://opencode.ai/schema.json",
      version: "1.14.28",
      notes: "",
    });
    expect(meta.schemaId).toBe("https://opencode.ai/schema.json");
    expect(meta.version).toBe("1.14.28");
  });
});
