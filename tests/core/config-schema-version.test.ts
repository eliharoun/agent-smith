import { describe, expect, test } from "bun:test";
import { CanonicalConfigSchema, parseConfig } from "../../src/core/config-schema";

/**
 * B10: schemaVersion field on agent.config.json
 *
 * The schema requires `schemaVersion: 1` (literal). `parseConfig()` migrates
 * legacy inputs that lack the field by injecting `schemaVersion: 1` before
 * zod parsing. Migration is in-memory only; the disk file is not rewritten
 * here (lazy write — the field appears naturally when something else writes
 * the config).
 *
 * Decisions captured in `docs/2026-05-22-road-to-v1-checklist.md` task B10
 * and `docs/v1-surface-config.md` open-question A2-Q5.
 */

const VALID_BASE = {
  schemaVersion: 1,
  name: "test-agent",
  description: "Use proactively for testing schemaVersion behavior in the canonical config schema.",
  targets: ["opencode"] as const,
  modelTier: "balanced" as const,
};

const VALID_BASE_NO_VERSION = {
  name: "test-agent",
  description: "Use proactively for testing schemaVersion behavior in the canonical config schema.",
  targets: ["opencode"] as const,
  modelTier: "balanced" as const,
};

describe("B10: schemaVersion on CanonicalConfigSchema", () => {
  test("schema accepts schemaVersion: 1", () => {
    const result = CanonicalConfigSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
  });

  test("schema rejects schemaVersion: 2 (only literal 1 is valid)", () => {
    const result = CanonicalConfigSchema.safeParse({ ...VALID_BASE, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  test("schema rejects schemaVersion: 0", () => {
    const result = CanonicalConfigSchema.safeParse({ ...VALID_BASE, schemaVersion: 0 });
    expect(result.success).toBe(false);
  });

  test("schema rejects missing schemaVersion (strict-parse path)", () => {
    const result = CanonicalConfigSchema.safeParse(VALID_BASE_NO_VERSION);
    expect(result.success).toBe(false);
  });

  test("schema rejects schemaVersion: '1' (string, not number)", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...VALID_BASE_NO_VERSION,
      schemaVersion: "1",
    });
    expect(result.success).toBe(false);
  });
});

describe("B10: parseConfig() migration", () => {
  test("parseConfig() accepts legacy input missing schemaVersion", () => {
    const result = parseConfig(VALID_BASE_NO_VERSION);
    expect(result.success).toBe(true);
  });

  test("parseConfig() output always has schemaVersion: 1", () => {
    const result = parseConfig(VALID_BASE_NO_VERSION);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
    }
  });

  test("parseConfig() preserves explicit schemaVersion: 1 (idempotent)", () => {
    const result = parseConfig(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
    }
  });

  test("parseConfig() rejects explicit wrong schemaVersion (migration does NOT overwrite)", () => {
    // If someone passes schemaVersion: 2, migration should not silently fix it.
    // The user gets a validation error so they can investigate.
    const result = parseConfig({ ...VALID_BASE_NO_VERSION, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  test("parseConfig() rejects non-object input (migration is object-only)", () => {
    const result = parseConfig("not an object");
    expect(result.success).toBe(false);
  });

  test("parseConfig() rejects null input", () => {
    const result = parseConfig(null);
    expect(result.success).toBe(false);
  });

  test("parseConfig() rejects array input (migration is object-only, not array)", () => {
    // Arrays are typeof 'object' but should not get schemaVersion injected.
    // Validates the Array.isArray() guard in the migration.
    const result = parseConfig([]);
    expect(result.success).toBe(false);
  });
});
