import { describe, expect, test } from "bun:test";
import { translateKiro } from "../../../src/core/translators/kiro";
import { expandPreset } from "../../../src/core/permission-presets";
import type { CanonicalConfig, RenderedAgent } from "../../../src/core/types";

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "Reviews code carefully and proactively",
    targets: ["kiro"],
    modelTier: "balanced",
    ...overrides,
  };
}

/** Narrow translateKiro return to its `format: "json"` variant for ergonomic test reads. */
function js(out: RenderedAgent): {
  data: Record<string, unknown>;
  warnings?: string[];
  relativePath: string;
} {
  if (out.format !== "json") throw new Error(`expected json, got ${out.format}`);
  return out;
}

describe("translateKiro: shape", () => {
  test("returns format=json with relativePath <name>.json", () => {
    const out = translateKiro(fixture(), "body", { resolvedModel: undefined });
    expect(out.format).toBe("json");
    expect(out.target).toBe("kiro");
    expect(out.relativePath).toBe("test-agent.json");
  });

  test("data has $schema, name, description, prompt", () => {
    const out = js(translateKiro(fixture(), "the-body", { resolvedModel: undefined }));
    expect(out.data.$schema).toBe(
      "https://raw.githubusercontent.com/aws/amazon-q-developer-cli/refs/heads/main/schemas/agent-v1.json",
    );
    expect(out.data.name).toBe("test-agent");
    expect(out.data.description).toBe("Reviews code carefully and proactively");
    expect(out.data.prompt).toBe("the-body");
  });

  test("does NOT emit includeMcpJson, useLegacyMcpJson, mcpServers, keyboardShortcut, welcomeMessage, toolAliases, toolsSettings", () => {
    // Even when the canonical config carries mcpServers (validator-only field),
    // smith MUST NOT emit it to kiro — the canonical schema is strict
    // (additionalProperties: false) and per-agent MCP spec emission is
    // future work (design §12).
    const out = js(
      translateKiro(fixture({ mcpServers: ["builder-mcp"] }), "body", {
        resolvedModel: undefined,
      }),
    );
    for (const forbidden of [
      "includeMcpJson",
      "useLegacyMcpJson",
      "mcpServers",
      "keyboardShortcut",
      "welcomeMessage",
      "toolAliases",
      "toolsSettings",
    ]) {
      expect(out.data[forbidden]).toBeUndefined();
    }
  });
});

describe("translateKiro: model emission", () => {
  test("emits model only when resolvedModel is set", () => {
    const noModel = js(translateKiro(fixture(), "body", { resolvedModel: undefined }));
    expect(noModel.data.model).toBeUndefined();

    const withModel = js(translateKiro(fixture(), "body", { resolvedModel: "claude-sonnet-4.6" }));
    expect(withModel.data.model).toBe("claude-sonnet-4.6");
  });
});

describe("translateKiro: permission mapping", () => {
  test("read-only preset → tools and allowedTools both contain read tool", () => {
    const out = js(
      translateKiro(fixture({ permission: expandPreset("read-only") }), "body", {
        resolvedModel: undefined,
      }),
    );
    const tools = out.data.tools as string[];
    const allowed = out.data.allowedTools as string[];
    expect(tools).toContain("read");
    expect(allowed).toContain("read");
  });

  test("ask action: tool in tools[] but NOT in allowedTools[]", () => {
    const out = js(
      translateKiro(fixture({ permission: { read: "allow", edit: "ask" } }), "body", {
        resolvedModel: undefined,
      }),
    );
    const tools = out.data.tools as string[];
    const allowed = out.data.allowedTools as string[];
    expect(tools).toContain("write"); // edit → write
    expect(allowed).not.toContain("write");
    expect(allowed).toContain("read"); // allow stays in both
  });

  test("deny action: tool omitted from both", () => {
    const out = js(
      translateKiro(fixture({ permission: { read: "allow", bash: "deny" } }), "body", {
        resolvedModel: undefined,
      }),
    );
    const tools = out.data.tools as string[];
    expect(tools).not.toContain("shell");
  });

  test("tools[] is sorted alphabetically for deterministic output", () => {
    const out = js(
      translateKiro(
        fixture({ permission: { read: "allow", glob: "allow", edit: "allow" } }),
        "body",
        { resolvedModel: undefined },
      ),
    );
    const tools = out.data.tools as string[];
    expect(tools).toEqual([...tools].sort());
  });
});

describe("translateKiro: skill:// resource emission", () => {
  test("permission.skill: allow → emits both skill:// globs", () => {
    const out = js(
      translateKiro(fixture({ permission: { skill: "allow" } }), "body", {
        resolvedModel: undefined,
      }),
    );
    const resources = out.data.resources as string[];
    expect(resources).toContain("skill://~/.kiro/skills/**/SKILL.md");
    expect(resources).toContain("skill://.kiro/skills/**/SKILL.md");
  });

  test("permission.skill: ask → emits skill:// globs AND warns", () => {
    const out = js(
      translateKiro(fixture({ permission: { skill: "ask" } }), "body", {
        resolvedModel: undefined,
      }),
    );
    const resources = out.data.resources as string[];
    expect(resources).toContain("skill://~/.kiro/skills/**/SKILL.md");
    expect(out.warnings?.some((w) => /ask has no native equivalent/i.test(w))).toBe(true);
  });

  test("permission.skill: deny → omits skill:// AND warns about partial enforcement", () => {
    const out = js(
      translateKiro(fixture({ permission: { skill: "deny" } }), "body", {
        resolvedModel: undefined,
      }),
    );
    const resources = (out.data.resources as string[]) ?? [];
    expect(resources.find((r) => r.startsWith("skill://"))).toBeUndefined();
    expect(out.warnings?.some((w) => /cannot fully prevent skill access/i.test(w))).toBe(true);
  });

  test("permission.skill pattern map: collapses to broadest action (allow > ask > deny)", () => {
    // pattern map { brainstorming: "allow", "*": "deny" } → broadest is allow.
    const out = js(
      translateKiro(
        fixture({ permission: { skill: { brainstorming: "allow", "*": "deny" } } }),
        "body",
        { resolvedModel: undefined },
      ),
    );
    const resources = out.data.resources as string[];
    expect(resources).toContain("skill://~/.kiro/skills/**/SKILL.md");
  });
});

describe("translateKiro: refresh hook", () => {
  test("emits hooks.agentSpawn entry only when withRefreshHooks=true and config has session refresh", () => {
    const out = js(
      translateKiro(
        fixture({
          knowledge: {
            sources: [
              {
                id: "live",
                type: "url",
                url: "https://x",
                delivery: "file",
                refresh: { mode: "session" },
              },
            ],
          },
        }),
        "body",
        { resolvedModel: undefined, withRefreshHooks: true },
      ),
    );
    const hooks = out.data.hooks as Record<string, unknown>;
    const agentSpawn = hooks.agentSpawn as Array<{ command: string }>;
    expect(agentSpawn[0]?.command).toContain("smith knowledge refresh-session");
    expect(agentSpawn[0]?.command).toContain("--agent test-agent");
    expect(agentSpawn[0]?.command).toContain("--platform kiro");
  });

  test("does not emit hooks when withRefreshHooks omitted (default consent gate)", () => {
    const out = js(
      translateKiro(
        fixture({
          knowledge: {
            sources: [
              {
                id: "live",
                type: "url",
                url: "https://x",
                delivery: "file",
                refresh: { mode: "session" },
              },
            ],
          },
        }),
        "body",
        { resolvedModel: undefined },
      ),
    );
    expect(out.data.hooks).toBeUndefined();
  });

  test("does not emit hooks when no source has session/always mode", () => {
    const out = js(
      translateKiro(
        fixture({
          knowledge: {
            sources: [{ id: "static", type: "file", path: "/tmp/x.md", delivery: "file" }],
          },
        }),
        "body",
        { resolvedModel: undefined, withRefreshHooks: true },
      ),
    );
    expect(out.data.hooks).toBeUndefined();
  });
});

describe("translateKiro: knowledge dir injection (via injectKnowledgeIntoRender)", () => {
  test("knowledge dir adds file:// URI to resources, deduped and sorted", async () => {
    const { injectKnowledgeIntoRender } = await import(
      "../../../src/core/knowledge/permission-grant"
    );
    const rendered = translateKiro(fixture({ permission: { skill: "allow" } }), "body", {
      resolvedModel: undefined,
    });
    const out = injectKnowledgeIntoRender(rendered, "/tmp/k");
    if (out.format !== "json") throw new Error("expected json");
    const resources = out.data.resources as string[];
    expect(resources).toContain("file:///tmp/k/**");
    // Sorted: skill:// comes after file:// alphabetically
    expect(resources).toEqual([...resources].sort());
  });
});
