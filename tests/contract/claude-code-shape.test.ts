import { describe, expect, test } from "bun:test";
import { expandPreset } from "../../src/core/permission-presets";
import { translateClaudeCode } from "../../src/core/translators/claude-code";
import type { CanonicalConfig } from "../../src/core/types";

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "Reviews code carefully and proactively",
    targets: ["claude-code"],
    modelTier: "balanced",
    ...overrides,
  };
}

const TOOL_NAME = /^[A-Z][A-Za-z]+$/;

function assertClaudeCodeShape(frontmatter: Record<string, unknown>): void {
  expect(typeof frontmatter.name).toBe("string");
  expect(typeof frontmatter.description).toBe("string");
  expect(typeof frontmatter.model).toBe("string");
  if ("allowed-tools" in frontmatter) {
    expect(typeof frontmatter["allowed-tools"]).toBe("string");
    const tools = (frontmatter["allowed-tools"] as string).split(", ");
    for (const t of tools) {
      expect(t).toMatch(TOOL_NAME);
    }
  }
}

function fm(out: ReturnType<typeof translateClaudeCode>): Record<string, unknown> {
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out.frontmatter;
}

describe("contract: claude-code frontmatter shape", () => {
  test("1. minimal config (no permission → no allowed-tools)", () => {
    const out = translateClaudeCode(fixture(), "body", { resolvedModel: "sonnet" });
    const f = fm(out);
    assertClaudeCodeShape(f);
    expect("allowed-tools" in f).toBe(false);
  });

  test("2. read-only preset", () => {
    const out = translateClaudeCode(fixture({ permission: expandPreset("read-only") }), "body", { resolvedModel: "sonnet" });
    const f = fm(out);
    assertClaudeCodeShape(f);
    expect(f["allowed-tools"]).toContain("Read");
  });

  test("3. read-edit preset", () => {
    const out = translateClaudeCode(fixture({ permission: expandPreset("read-edit") }), "body", { resolvedModel: "sonnet" });
    assertClaudeCodeShape(fm(out));
  });

  test("4. custom permission with deny", () => {
    const out = translateClaudeCode(
      fixture({ permission: { read: "allow", bash: "deny" } }),
      "body",
      { resolvedModel: "sonnet" },
    );
    const f = fm(out);
    assertClaudeCodeShape(f);
    expect(f["allowed-tools"]).toBe("Read");
  });
});
