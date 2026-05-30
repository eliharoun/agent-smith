import { describe, expect, test } from "bun:test";
import { expandPreset } from "../../src/core/permission-presets";
import { translateCodex } from "../../src/core/translators/codex";
import type { CanonicalConfig } from "../../src/core/types";

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "Reviews code carefully and proactively",
    targets: ["codex"],
    modelTier: "balanced",
    ...overrides,
  };
}

const ALLOWED_KEYS = new Set(["name", "description", "allowed_tools"]);

function assertCodexShape(frontmatter: Record<string, unknown>): void {
  for (const key of Object.keys(frontmatter)) {
    expect(ALLOWED_KEYS.has(key)).toBe(true);
  }
  expect(typeof frontmatter.name).toBe("string");
  expect(typeof frontmatter.description).toBe("string");
  if ("allowed_tools" in frontmatter) {
    expect(Array.isArray(frontmatter.allowed_tools)).toBe(true);
    for (const t of frontmatter.allowed_tools as unknown[]) {
      expect(typeof t).toBe("string");
    }
  }
}

function fm(out: ReturnType<typeof translateCodex>): Record<string, unknown> {
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out.frontmatter;
}

describe("contract: codex frontmatter shape", () => {
  test("1. minimal config (no permission)", () => {
    const out = translateCodex(fixture(), "body", { resolvedModel: undefined });
    assertCodexShape(fm(out));
  });

  test("2. read-only preset", () => {
    const out = translateCodex(fixture({ permission: expandPreset("read-only") }), "body", { resolvedModel: undefined });
    assertCodexShape(fm(out));
  });

  test("3. read-edit preset", () => {
    const out = translateCodex(fixture({ permission: expandPreset("read-edit") }), "body", { resolvedModel: undefined });
    assertCodexShape(fm(out));
  });

  test("4. custom permission", () => {
    const out = translateCodex(fixture({ permission: { read: "allow", bash: "allow" } }), "body", { resolvedModel: undefined });
    assertCodexShape(fm(out));
  });
});
