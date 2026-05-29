import { describe, expect, test } from "bun:test";
import { translateOpenCode } from "../../../src/core/translators/opencode";
import type { CanonicalConfig, RenderedAgent } from "../../../src/core/types";

const baseConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "code-reviewer",
  description: "Use proactively to review modified code for issues",
  targets: ["opencode"],
  modelTier: "balanced",
  mode: "subagent",
};

/**
 * Wrapper that calls translateOpenCode and narrows the discriminated
 * return to its markdown-frontmatter variant. opencode always produces
 * markdown-frontmatter, so the narrow is total.
 */
function toc(...args: Parameters<typeof translateOpenCode>): {
  target: RenderedAgent["target"];
  format: "markdown-frontmatter";
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warnings?: string[];
  bundlePath?: string;
} {
  const out = translateOpenCode(...args);
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out;
}

describe("translators/opencode", () => {
  test("emits the correct filename", () => {
    const out = toc(baseConfig, "BODY", { resolvedModel: undefined });
    expect(out.relativePath).toBe("code-reviewer.md");
    expect(out.target).toBe("opencode");
  });

  test("frontmatter contains required fields", () => {
    const out = toc(baseConfig, "BODY", {
      resolvedModel: "anthropic/claude-sonnet-4-5",
    });
    expect(out.frontmatter.description).toBe(baseConfig.description);
    expect(out.frontmatter.mode).toBe("subagent");
    expect(out.frontmatter.model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("modelTier=opus maps to opus model", () => {
    const out = toc({ ...baseConfig, modelTier: "high" }, "B", {
      resolvedModel: "anthropic/claude-opus-4-5",
    });
    expect(out.frontmatter.model).toBe("anthropic/claude-opus-4-5");
  });

  test("modelTier=haiku maps to haiku model", () => {
    const out = toc({ ...baseConfig, modelTier: "fast" }, "B", {
      resolvedModel: "anthropic/claude-haiku-4-5",
    });
    expect(out.frontmatter.model).toBe("anthropic/claude-haiku-4-5");
  });

  test("modelTier=inherit omits the model field", () => {
    const out = toc({ ...baseConfig, modelTier: "inherit" }, "B", {
      resolvedModel: undefined,
    });
    expect("model" in out.frontmatter).toBe(false);
  });

  test("optional fields appear only when present in canonical config", () => {
    const out = toc(
      {
        ...baseConfig,
        temperature: 0.3,
        color: "blue",
        permission: { bash: { "git *": "allow" } },
      },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.temperature).toBe(0.3);
    expect(out.frontmatter.color).toBe("blue");
    expect(out.frontmatter.permission).toEqual({ bash: { "git *": "allow" } });
  });

  test("never emits the deprecated `tools` field", () => {
    const out = toc(baseConfig, "B", { resolvedModel: undefined });
    expect("tools" in out.frontmatter).toBe(false);
    expect("disable" in out.frontmatter).toBe(false);
  });

  test("passes through structured permission verbatim", () => {
    const permission = {
      read: "allow" as const,
      bash: { "git *": "allow" as const, "*": "deny" as const },
    };
    const out = toc({ ...baseConfig, permission }, "B", {
      resolvedModel: undefined,
    });
    expect(out.frontmatter.permission).toEqual(permission);
  });

  test("omits permission when not set", () => {
    const out = toc(baseConfig, "B", { resolvedModel: undefined });
    expect("permission" in out.frontmatter).toBe(false);
  });

  test("body is passed through unchanged", () => {
    const out = toc(baseConfig, "BODY_CONTENT\nHELLO", {
      resolvedModel: undefined,
    });
    expect(out.body).toBe("BODY_CONTENT\nHELLO");
  });

  test("passes skill capability through verbatim (allow shorthand)", () => {
    const out = toc(
      { ...baseConfig, permission: { skill: "allow" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.permission).toEqual({ skill: "allow" });
  });

  test("passes skill capability through verbatim (deny shorthand)", () => {
    const out = toc(
      { ...baseConfig, permission: { skill: "deny" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.permission).toEqual({ skill: "deny" });
  });

  test("passes skill capability through verbatim (pattern map)", () => {
    const permission = {
      skill: { "test-driven-development": "allow" as const, "*": "deny" as const },
    };
    const out = toc({ ...baseConfig, permission }, "B", {
      resolvedModel: undefined,
    });
    expect(out.frontmatter.permission).toEqual(permission);
  });

  test("passes skill alongside other capabilities verbatim", () => {
    const permission = {
      read: "allow" as const,
      bash: "deny" as const,
      skill: { brainstorming: "allow" as const, "*": "deny" as const },
    };
    const out = toc({ ...baseConfig, permission }, "B", {
      resolvedModel: undefined,
    });
    expect(out.frontmatter.permission).toEqual(permission);
  });
});
