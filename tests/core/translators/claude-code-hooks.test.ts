import { describe, expect, test } from "bun:test";
import { translateClaudeCode } from "../../../src/core/translators/claude-code";
import type {
  CanonicalConfig,
  RenderedAgent,
  ResolvedModelContext,
} from "../../../src/core/types";

const ctx: ResolvedModelContext = { resolvedModel: undefined };
const ctxWithHooks: ResolvedModelContext = {
  resolvedModel: undefined,
  withRefreshHooks: true,
};

function baseConfig(overrides: Partial<CanonicalConfig>): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "test agent",
    targets: ["claude-code"],
    modelTier: "balanced",
    ...overrides,
  };
}

/** Narrow translateClaudeCode return so tests can read .frontmatter directly. */
function tcc(...args: Parameters<typeof translateClaudeCode>): {
  frontmatter: Record<string, unknown>;
} {
  const out = translateClaudeCode(...args);
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out;
}

describe("translateClaudeCode hooks", () => {
  test("emits no hooks block when no source has session/always mode", () => {
    const config = baseConfig({
      knowledge: {
        sources: [
          { id: "static", type: "file", path: "/tmp/x.md", delivery: "file" },
          {
            id: "polled",
            type: "webpage",
            url: "https://x",
            delivery: "file",
            refresh: "1h",
          },
        ],
      },
    });

    // Even with opt-in, no session/always sources means no hooks.
    const result = tcc(config, "body", ctxWithHooks);
    expect(result.frontmatter.hooks).toBeUndefined();
  });

  test("emits SessionStart hook when any source has mode=session AND withRefreshHooks is true", () => {
    const config = baseConfig({
      knowledge: {
        sources: [
          { id: "static", type: "file", path: "/tmp/x.md", delivery: "file" },
          {
            id: "live",
            type: "webpage",
            url: "https://x",
            delivery: "file",
            refresh: { mode: "session" },
          },
        ],
      },
    });

    const result = tcc(config, "body", ctxWithHooks);
    expect(result.frontmatter.hooks).toEqual({
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command:
                "smith knowledge refresh-session --agent test-agent --platform claude-code",
              statusMessage: "Refreshing test-agent knowledge…",
              timeout: 5,
            },
          ],
        },
      ],
    });
  });

  test("emits SessionStart hook when any source has mode=always AND withRefreshHooks is true", () => {
    const config = baseConfig({
      knowledge: {
        sources: [
          {
            id: "critical",
            type: "confluence",
            space: "ENG",
            delivery: "file",
            refresh: { mode: "always" },
          },
        ],
      },
    });
    const result = tcc(config, "body", ctxWithHooks);
    expect(result.frontmatter.hooks).toBeDefined();
  });

  test("does not emit hooks when knowledge block is missing", () => {
    const config = baseConfig({});
    const result = tcc(config, "body", ctxWithHooks);
    expect(result.frontmatter.hooks).toBeUndefined();
  });

  test("does NOT emit hooks for session-mode source when withRefreshHooks is absent (default)", () => {
    const config = baseConfig({
      knowledge: {
        sources: [
          {
            id: "live",
            type: "webpage",
            url: "https://x",
            delivery: "file",
            refresh: { mode: "session" },
          },
        ],
      },
    });
    const result = tcc(config, "body", ctx);
    expect(result.frontmatter.hooks).toBeUndefined();
  });
});
