import { describe, expect, test } from "bun:test";
import { translateCodex } from "../../../src/core/translators/codex";
import type { CanonicalConfig, RenderedAgent } from "../../../src/core/types";

const baseConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "code-reviewer",
  description: "Use proactively to review code",
  targets: ["codex"],
  modelTier: "balanced",
};

/**
 * Wrapper that calls translateCodex and narrows the discriminated return
 * to its markdown-frontmatter variant. codex always produces
 * markdown-frontmatter, so the narrow is total.
 */
function tcx(...args: Parameters<typeof translateCodex>): {
  target: RenderedAgent["target"];
  format: "markdown-frontmatter";
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warnings?: string[];
  bundlePath?: string;
  sidecars?: NonNullable<RenderedAgent["sidecars"]>;
} {
  const out = translateCodex(...args);
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out;
}

describe("translators/codex", () => {
  test("relativePath nests under <name>/SKILL.md (AGENTS.md skill convention)", () => {
    const out = tcx(baseConfig, "B", { resolvedModel: undefined });
    expect(out.relativePath).toBe("code-reviewer/SKILL.md");
    expect(out.target).toBe("codex");
  });

  test("frontmatter contains only name and description when no permission", () => {
    const out = tcx(baseConfig, "B", { resolvedModel: undefined });
    expect(out.frontmatter).toEqual({
      name: "code-reviewer",
      description: baseConfig.description,
    });
    expect(out.warnings).toBeUndefined();
  });

  test("ignores all platform-specific fields", () => {
    const out = tcx(
      { ...baseConfig, mode: "subagent", temperature: 0.3, color: "red" },
      "B",
      { resolvedModel: undefined },
    );
    expect(Object.keys(out.frontmatter).sort()).toEqual(["description", "name"]);
  });

  test("body passes through", () => {
    const out = tcx(baseConfig, "HELLO\nWORLD", { resolvedModel: undefined });
    expect(out.body).toBe("HELLO\nWORLD");
  });
});

describe("translators/codex: permission → allowed_tools", () => {
  test("single allow group emits matching tool", () => {
    const out = tcx({ ...baseConfig, permission: { read: "allow" } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toEqual(["Read"]);
    expect(out.warnings).toBeUndefined();
  });

  test("multiple allow groups produce alpha-sorted array", () => {
    const out = tcx(
      { ...baseConfig, permission: { read: "allow", glob: "allow" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.allowed_tools).toEqual(["Glob", "Read"]);
    expect(out.warnings).toBeUndefined();
  });

  test("deny is omitted from allowed_tools (no warning — platform truism)", () => {
    const out = tcx({ ...baseConfig, permission: { read: "allow", bash: "deny" } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toEqual(["Read"]);
    // The "codex has no deny semantic" warning was dropped (always-true
    // platform fact). Deny is honored by exclusion.
    expect(out.warnings ?? []).toEqual([]);
  });

  test("ask emits one per-tool warning per expanded tool and no allowed_tools", () => {
    const out = tcx({ ...baseConfig, permission: { edit: "ask" } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toBeUndefined();
    // edit → Edit, Write, MultiEdit, NotebookEdit (alpha-sorted by mapping module)
    expect(out.warnings).toEqual([
      "Permission action 'ask' has no codex equivalent for tool 'Edit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no codex equivalent for tool 'MultiEdit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no codex equivalent for tool 'NotebookEdit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no codex equivalent for tool 'Write'; omitting. Use 'allow' or 'deny'.",
    ]);
  });

  test("pattern-based permission emits mapping warning and collapses to broadest", () => {
    const out = tcx({ ...baseConfig, permission: { bash: { "git *": "allow" } } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toEqual(["Bash"]);
    expect(out.warnings).toEqual([
      "Pattern-based permissions for group 'bash' are not supported on this platform; using broadest action 'allow'",
    ]);
  });

  test("groups absent from CODEX_TOOL_MAP are silently skipped (deferred-vocabulary contract)", () => {
    // `task` has no entry in data/codex-tool-map.json; mapping module no-ops it.
    const out = tcx({ ...baseConfig, permission: { task: "allow" } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });

  test("permission.skill is silently ignored on codex (truism — no skill runtime)", () => {
    // Codex has no skill-tool runtime. The translator no longer emits a
    // runtime warning for this; the contract is documented in
    // guide/06-permissions-and-platforms.md.
    const out = tcx({ ...baseConfig, permission: { skill: "allow" } }, "B", { resolvedModel: undefined });
    expect(out.frontmatter.allowed_tools).toBeUndefined();
    expect(out.warnings ?? []).toEqual([]);
  });

  test("permission.skill is silently ignored regardless of action shorthand", () => {
    const outDeny = tcx({ ...baseConfig, permission: { skill: "deny" } }, "B", { resolvedModel: undefined });
    expect(outDeny.warnings ?? []).toEqual([]);
    const outAsk = tcx({ ...baseConfig, permission: { skill: "ask" } }, "B", { resolvedModel: undefined });
    // ask still emits the per-tool ask warning (those ARE actionable).
    // skill: "ask" maps to the Skill tool name in the codex tool map; if
    // codex's tool map omits skill (which it does), nothing fires.
    expect((outAsk.warnings ?? []).filter((w) => w.includes("skill-tool runtime"))).toEqual([]);
  });

  test("permission.skill pattern map emits ONLY the pattern warning (skill truism dropped)", () => {
    // Pattern-based permissions ARE actionable (user can simplify their
    // config), so that warning stays. The codex skill-runtime truism was
    // dropped.
    const out = tcx(
      { ...baseConfig, permission: { skill: { brainstorming: "allow", "*": "deny" } } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.allowed_tools).toBeUndefined();
    expect(out.warnings).toEqual([
      "Pattern-based permissions for group 'skill' are not supported on this platform; using broadest action 'allow'",
    ]);
  });

  test("permission.skill alongside other capabilities — silent on truism warnings", () => {
    const out = tcx(
      { ...baseConfig, permission: { read: "allow", skill: "allow", bash: "deny" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.allowed_tools).toEqual(["Read"]);
    // Both deny→omitted and skill-no-runtime were dropped as truisms.
    expect(out.warnings ?? []).toEqual([]);
  });
});

describe("translators/codex: per-agent MCP emission via sidecar", () => {
  test("non-empty mcpServers leaves frontmatter free of mcp-related fields", () => {
    // mcpServers is conveyed via the sibling `agents/openai.yaml`
    // sidecar, NOT via the SKILL.md frontmatter. Codex defaults to
    // inheriting all global MCP servers from `~/.codex/config.toml`,
    // so runtime visibility is unchanged by this emission — the
    // sidecar is purely a documentation surface today, and an
    // install-prompt input for the future originator-gate lift.
    const out = tcx(
      { ...baseConfig, mcpServers: ["foo", "bar"] },
      "B",
      { resolvedModel: undefined },
    );
    expect("mcpServers" in out.frontmatter).toBe(false);
    expect("mcp" in out.frontmatter).toBe(false);
    // Main render path is unchanged regardless of sidecar emission.
    expect(out.relativePath).toBe("code-reviewer/SKILL.md");
  });

  test("emits agents/openai.yaml sidecar when bundle has mcpServers", () => {
    const out = tcx(
      { ...baseConfig, mcpServers: ["agent-smith-knowledge", "github-mcp"] },
      "BODY",
      { resolvedModel: undefined },
    );
    expect(out.sidecars).toBeDefined();
    expect(out.sidecars).toHaveLength(1);
    const sidecar = out.sidecars![0]!;
    // Path is rooted at the same install root as the main file,
    // mirroring SKILL.md's `<name>/SKILL.md` shape.
    expect(sidecar.relativePath).toBe("code-reviewer/agents/openai.yaml");
    // Both server names should appear in dependencies.tools.
    expect(sidecar.content).toContain("agent-smith-knowledge");
    expect(sidecar.content).toContain("github-mcp");
    expect(sidecar.content).toContain("type: mcp");
  });

  test("emits no sidecar when bundle has no mcpServers", () => {
    const out = tcx(
      { ...baseConfig, mcpServers: [] },
      "BODY",
      { resolvedModel: undefined },
    );
    expect(out.sidecars).toBeUndefined();
  });

  test("emits no sidecar when mcpServers is undefined (byte-identical preservation)", () => {
    const out = tcx(baseConfig, "BODY", { resolvedModel: undefined });
    expect(out.sidecars).toBeUndefined();
  });

  test("preserves the main render path regardless of sidecar emission", () => {
    const withMcp = tcx(
      { ...baseConfig, mcpServers: ["x"] },
      "BODY",
      { resolvedModel: undefined },
    );
    const withoutMcp = tcx(baseConfig, "BODY", { resolvedModel: undefined });
    expect(withMcp.relativePath).toBe(withoutMcp.relativePath);
  });

  test("sidecar YAML emits the canonical dependencies.tools shape", () => {
    const out = tcx(
      { ...baseConfig, mcpServers: ["one"] },
      "BODY",
      { resolvedModel: undefined },
    );
    const yaml = out.sidecars![0]!.content;
    // Top-level shape: dependencies → tools array of {type, value, description}.
    expect(yaml).toMatch(/dependencies:/);
    expect(yaml).toMatch(/tools:/);
    expect(yaml).toMatch(/value:\s*one/);
    // No CanonicalConfig.mcpServerDescriptions field exists today, so
    // `description: ""` is the placeholder slot. Assert the key is
    // present so the wire shape stays stable.
    expect(yaml).toMatch(/description:/);
  });
});
