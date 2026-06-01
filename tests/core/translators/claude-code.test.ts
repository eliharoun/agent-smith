import { describe, expect, test } from "bun:test";
import { expandPreset } from "../../../src/core/permission-presets";
import { translateClaudeCode } from "../../../src/core/translators/claude-code";
import type { CanonicalConfig, RenderedAgent } from "../../../src/core/types";

const baseConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "code-reviewer",
  description: "Use proactively to review modified code",
  targets: ["claude-code"],
  modelTier: "balanced",
};

/**
 * Wrapper that calls translateClaudeCode and narrows the discriminated
 * return to its markdown-frontmatter variant. claude-code always produces
 * markdown-frontmatter, so the narrow is total. Lets the existing tests
 * read `.frontmatter` / `.body` without per-test type narrowing.
 */
function tcc(...args: Parameters<typeof translateClaudeCode>): {
  target: RenderedAgent["target"];
  format: "markdown-frontmatter";
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warnings?: string[];
  bundlePath?: string;
} {
  const out = translateClaudeCode(...args);
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out;
}

describe("translators/claude-code", () => {
  test("filename matches agent name and target is set", () => {
    const out = tcc(baseConfig, "B", { resolvedModel: undefined });
    expect(out.relativePath).toBe("code-reviewer.md");
    expect(out.target).toBe("claude-code");
  });

  test("frontmatter has name, description, and model; body passes through", () => {
    const out = tcc(baseConfig, "HELLO", { resolvedModel: "sonnet" });
    expect(out.frontmatter.name).toBe("code-reviewer");
    expect(out.frontmatter.description).toBe(baseConfig.description);
    expect(out.frontmatter.model).toBe("sonnet");
    expect(out.body).toBe("HELLO");
  });

  test("modelTier=inherit emits the literal string 'inherit'", () => {
    const out = tcc({ ...baseConfig, modelTier: "inherit" }, "B", {
      resolvedModel: "inherit",
    });
    expect(out.frontmatter.model).toBe("inherit");
  });

  // --- permission-derived allowed-tools ---

  test("single allow group → single tool, no warnings", () => {
    const out = tcc(
      { ...baseConfig, permission: { read: "allow" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Read");
    expect(out.warnings).toBeUndefined();
  });

  test("multiple allow groups → alphabetically sorted comma list, no warnings", () => {
    const out = tcc(
      { ...baseConfig, permission: { read: "allow", glob: "allow" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Glob, Read");
    expect(out.warnings).toBeUndefined();
  });

  test("allow + deny → only allow emitted, ONE summary deny warning", () => {
    const out = tcc(
      { ...baseConfig, permission: { read: "allow", bash: "deny" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Read");
    // The "claude-code has no deny semantic" warning was dropped as a
    // platform truism (see guide/06-permissions-and-platforms.md). Deny is
    // still honored — denied tools simply don't appear in allowed-tools.
    expect(out.warnings ?? []).not.toContain(
      "claude-code has no deny semantic; denied tools are simply omitted from allowed-tools.",
    );
  });

  test("ask group → no allowed-tools, one warning per expanded tool (alphabetical)", () => {
    const out = tcc(
      { ...baseConfig, permission: { edit: "ask" } },
      "B",
      { resolvedModel: undefined },
    );
    expect("allowed-tools" in out.frontmatter).toBe(false);
    // edit → [Edit, Write, MultiEdit, NotebookEdit]; expansion sorts alphabetically:
    // Edit, MultiEdit, NotebookEdit, Write
    expect(out.warnings).toEqual([
      "Permission action 'ask' has no claude-code equivalent for tool 'Edit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no claude-code equivalent for tool 'MultiEdit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no claude-code equivalent for tool 'NotebookEdit'; omitting. Use 'allow' or 'deny'.",
      "Permission action 'ask' has no claude-code equivalent for tool 'Write'; omitting. Use 'allow' or 'deny'.",
    ]);
  });

  test("pattern-based permission emits ONE warning forwarded from mapping module", () => {
    const out = tcc(
      { ...baseConfig, permission: { bash: { "git *": "allow" } } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Bash");
    expect(out.warnings).toEqual([
      "Pattern-based permissions for group 'bash' are not supported on this platform; using broadest action 'allow'",
    ]);
  });

  test("no permission → no allowed-tools, no warnings", () => {
    const out = tcc(baseConfig, "B", { resolvedModel: undefined });
    expect("allowed-tools" in out.frontmatter).toBe(false);
    expect(out.warnings).toBeUndefined();
  });

  test("OpenCode-only fields (mode, color, temperature) and permission itself are dropped from frontmatter", () => {
    const out = tcc(
      {
        ...baseConfig,
        mode: "subagent",
        color: "blue",
        temperature: 0.4,
        permission: { read: "allow" },
      },
      "B",
      { resolvedModel: undefined },
    );
    expect("mode" in out.frontmatter).toBe(false);
    expect("color" in out.frontmatter).toBe(false);
    expect("temperature" in out.frontmatter).toBe(false);
    expect("permission" in out.frontmatter).toBe(false);
    // sanity: derived field still present
    expect(out.frontmatter["allowed-tools"]).toBe("Read");
  });

  test("expandPreset('read-edit') → all read/edit/task tools allowed; deny warning fires", () => {
    const out = tcc(
      { ...baseConfig, permission: expandPreset("read-edit") },
      "B",
      { resolvedModel: undefined },
    );
    const allowed = out.frontmatter["allowed-tools"] as string;
    const tools = allowed.split(", ");
    // read-edit allows: read, glob, grep, list, lsp(no map), edit (Edit/Write/MultiEdit/NotebookEdit), task, skill
    // lsp has no claude-code equivalent → silently skipped
    expect(tools).toEqual([
      "Edit",
      "Glob",
      "Grep",
      "LS",
      "MultiEdit",
      "NotebookEdit",
      "Read",
      "Skill",
      "Task",
      "Write",
    ]);
    // bash, webfetch, websearch are denied. The "deny → omitted" warning
    // was dropped (platform truism); deny is still honored by exclusion.
    expect(out.warnings ?? []).toEqual([]);
  });

  test("skill:'allow' → Skill in allowed-tools, no warnings", () => {
    const out = tcc(
      { ...baseConfig, permission: { skill: "allow" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Skill");
    expect(out.warnings).toBeUndefined();
  });

  test("skill:'deny' → no allowed-tools, no warnings (deny → omitted is implicit)", () => {
    const out = tcc(
      { ...baseConfig, permission: { skill: "deny" } },
      "B",
      { resolvedModel: undefined },
    );
    expect("allowed-tools" in out.frontmatter).toBe(false);
    // The "deny → omitted" warning was dropped as a platform truism.
    expect(out.warnings ?? []).toEqual([]);
  });

  test("skill:'ask' → no allowed-tools, per-tool ask warning", () => {
    const out = tcc(
      { ...baseConfig, permission: { skill: "ask" } },
      "B",
      { resolvedModel: undefined },
    );
    expect("allowed-tools" in out.frontmatter).toBe(false);
    expect(out.warnings).toEqual([
      "Permission action 'ask' has no claude-code equivalent for tool 'Skill'; omitting. Use 'allow' or 'deny'.",
    ]);
  });

  test("skill pattern map → Skill in allowed-tools (broadest action), pattern warning fires", () => {
    // claude-code can't filter Skill by skill-name (no per-skill tool variants),
    // so a pattern map collapses to the broadest action via the mapping module.
    const out = tcc(
      { ...baseConfig, permission: { skill: { brainstorming: "allow", "*": "deny" } } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Skill");
    expect(out.warnings).toEqual([
      "Pattern-based permissions for group 'skill' are not supported on this platform; using broadest action 'allow'",
    ]);
  });

  test("skill alongside other capabilities sorts alphabetically and merges warnings correctly", () => {
    const out = tcc(
      { ...baseConfig, permission: { read: "allow", skill: "allow", bash: "deny" } },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter["allowed-tools"]).toBe("Read, Skill");
    // bash is denied. The "deny → omitted" warning is suppressed (truism).
    expect(out.warnings ?? []).toEqual([]);
  });

  // --- Task 5b: defer-to-AGENTS.md when both targets present ---

  test("defers to AGENTS.md when both 'claude-code' and 'agents-md' targets are present (default)", () => {
    const out = tcc(
      { ...baseConfig, targets: ["claude-code", "agents-md"] },
      "FULL BODY CONTENT",
      { resolvedModel: undefined },
    );
    // body is replaced with the 1-line pointer; frontmatter is preserved.
    expect(out.body).toBe("See AGENTS.md.");
    expect(out.frontmatter.name).toBe("code-reviewer");
    expect(out.frontmatter.description).toBe(baseConfig.description);
  });

  test("explicit deferToAgentsMd=false overrides default-when-both-present", () => {
    const out = tcc(
      {
        ...baseConfig,
        targets: ["claude-code", "agents-md"],
        targetOptions: { claudeCode: { deferToAgentsMd: false } },
      },
      "FULL BODY CONTENT",
      { resolvedModel: undefined },
    );
    expect(out.body).toBe("FULL BODY CONTENT");
  });

  test("does NOT defer when only 'claude-code' is in targets (no agents-md)", () => {
    const out = tcc(baseConfig, "FULL BODY CONTENT", { resolvedModel: undefined });
    expect(out.body).toBe("FULL BODY CONTENT");
  });

  // --- per-agent MCP scoping (mcpServers frontmatter) ---

  test("non-empty mcpServers → frontmatter mcpServers is the sorted name-string list (default-on)", () => {
    const out = tcc(
      { ...baseConfig, mcpServers: ["foo", "bar"] },
      "B",
      { resolvedModel: undefined },
    );
    expect(out.frontmatter.mcpServers).toEqual(["bar", "foo"]);
  });

  test("empty/absent mcpServers → no frontmatter mcpServers field", () => {
    const out1 = tcc(baseConfig, "B", { resolvedModel: undefined });
    expect("mcpServers" in out1.frontmatter).toBe(false);
    const out2 = tcc(
      { ...baseConfig, mcpServers: [] },
      "B",
      { resolvedModel: undefined },
    );
    expect("mcpServers" in out2.frontmatter).toBe(false);
  });

  test("scopeMcpServers=false opts out even when bundle declares servers", () => {
    const out = tcc(
      {
        ...baseConfig,
        mcpServers: ["foo"],
        targetOptions: { claudeCode: { scopeMcpServers: false } },
      },
      "B",
      { resolvedModel: undefined },
    );
    expect("mcpServers" in out.frontmatter).toBe(false);
  });
});
