import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_TOOL_MAP,
  CODEX_TOOL_MAP,
  expandPermissionToToolList,
} from "../../src/core/permission-mapping";
import { expandPreset } from "../../src/core/permission-presets";

describe("core/permission-mapping", () => {
  test("1. {read:'allow'} + claude map → allow=['Read']", () => {
    const result = expandPermissionToToolList({ read: "allow" }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: ["Read"],
      ask: [],
      deny: [],
      warnings: [],
    });
  });

  test("2. {read:'allow', edit:'deny'} + claude map → edit tools sorted in deny", () => {
    const result = expandPermissionToToolList(
      { read: "allow", edit: "deny" },
      CLAUDE_CODE_TOOL_MAP,
    );
    expect(result).toEqual({
      allow: ["Read"],
      ask: [],
      deny: ["Edit", "MultiEdit", "NotebookEdit", "Write"],
      warnings: [],
    });
  });

  test("3. {edit:'ask'} + claude map → all edit tools sorted in ask", () => {
    const result = expandPermissionToToolList({ edit: "ask" }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: [],
      ask: ["Edit", "MultiEdit", "NotebookEdit", "Write"],
      deny: [],
      warnings: [],
    });
  });

  test("4. {lsp:'allow'} + claude map → all empty buckets, no warnings (group absent from map)", () => {
    const result = expandPermissionToToolList({ lsp: "allow" }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: [],
      ask: [],
      deny: [],
      warnings: [],
    });
  });

  test("5. pattern-based bash permissions emit warning + use broadest action", () => {
    const result = expandPermissionToToolList(
      { bash: { "git *": "allow", "*": "deny" } },
      CLAUDE_CODE_TOOL_MAP,
    );
    expect(result).toEqual({
      allow: ["Bash"],
      ask: [],
      deny: [],
      warnings: [
        "Pattern-based permissions for group 'bash' are not supported on this platform; using broadest action 'allow'",
      ],
    });
  });

  test("6. output buckets are sorted alphabetically", () => {
    // edit map = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] (unsorted in source);
    // assert the output is in sorted order, not source order.
    const result = expandPermissionToToolList({ edit: "allow" }, CLAUDE_CODE_TOOL_MAP);
    expect(result.allow).toEqual(["Edit", "MultiEdit", "NotebookEdit", "Write"]);
    expect(result.allow).not.toEqual(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  });

  test("7. empty permission object → all empty buckets, no warnings", () => {
    const result = expandPermissionToToolList({}, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: [],
      ask: [],
      deny: [],
      warnings: [],
    });
  });

  test("8. expandPreset('read-only') + claude map → allow contains read tools, not edit/bash/task", () => {
    const result = expandPermissionToToolList(expandPreset("read-only"), CLAUDE_CODE_TOOL_MAP);
    expect(result.allow).toContain("Read");
    expect(result.allow).toContain("Glob");
    expect(result.allow).toContain("Grep");
    expect(result.allow).toContain("LS");
    expect(result.allow).not.toContain("Edit");
    expect(result.allow).not.toContain("Write");
    expect(result.allow).not.toContain("Bash");
    expect(result.allow).not.toContain("Task");
  });

  test("9. expandPreset('read-edit') + claude map → allow contains Edit, Write, Task", () => {
    const result = expandPermissionToToolList(expandPreset("read-edit"), CLAUDE_CODE_TOOL_MAP);
    expect(result.allow).toContain("Edit");
    expect(result.allow).toContain("Write");
    expect(result.allow).toContain("Task");
  });

  test("10. expandPreset('full') + claude map → deny is empty", () => {
    const result = expandPermissionToToolList(expandPreset("full"), CLAUDE_CODE_TOOL_MAP);
    expect(result.deny).toEqual([]);
  });

  test("CODEX_TOOL_MAP is exported and contains the expected keys", () => {
    // Sanity: the codex map ships with a known subset of groups.
    expect(Object.keys(CODEX_TOOL_MAP).sort()).toEqual([
      "bash",
      "edit",
      "glob",
      "grep",
      "list",
      "read",
    ]);
  });

  test("11. empty pattern record → warning, no emission, no crash", () => {
    const result = expandPermissionToToolList({ bash: {} }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: [],
      ask: [],
      deny: [],
      warnings: ["Pattern-based permissions for group 'bash' has no patterns; skipping"],
    });
  });

  test("12. tie-break in broadestAction: all-allow record resolves to 'allow'", () => {
    const result = expandPermissionToToolList(
      { bash: { a: "allow", b: "allow" } },
      CLAUDE_CODE_TOOL_MAP,
    );
    expect(result).toEqual({
      allow: ["Bash"],
      ask: [],
      deny: [],
      warnings: [
        "Pattern-based permissions for group 'bash' are not supported on this platform; using broadest action 'allow'",
      ],
    });
  });

  test("13. {skill:'allow'} + claude map → allow=['Skill']", () => {
    const result = expandPermissionToToolList({ skill: "allow" }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: ["Skill"],
      ask: [],
      deny: [],
      warnings: [],
    });
  });

  test("14. {skill:'deny'} + claude map → deny=['Skill']", () => {
    const result = expandPermissionToToolList({ skill: "deny" }, CLAUDE_CODE_TOOL_MAP);
    expect(result).toEqual({
      allow: [],
      ask: [],
      deny: ["Skill"],
      warnings: [],
    });
  });

  test("CORE-12: warns on unknown permission group (typo detection)", () => {
    // 'netwerk' is not a known opencode permission group — likely a typo for 'webfetch'/etc.
    // Without typo detection the user silently gets an empty allow list and thinks
    // they granted a permission they didn't.
    const result = expandPermissionToToolList({ netwerk: "allow" }, CLAUDE_CODE_TOOL_MAP);
    expect(result.allow).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/unknown permission group/i);
    expect(result.warnings[0]).toContain("netwerk");
    // Suggestion list should be present so the user can spot the typo.
    expect(result.warnings[0]).toContain("supported groups");
  });

  test("CORE-12: silent skip for legitimate cross-platform-only group (external_directory on claude-code)", () => {
    // external_directory is a real opencode permission group (used in presets) but
    // has no claude-code tool equivalent — it must silent-skip, not warn.
    const result = expandPermissionToToolList(
      { external_directory: "allow" },
      CLAUDE_CODE_TOOL_MAP,
    );
    expect(result).toEqual({
      allow: [],
      ask: [],
      deny: [],
      warnings: [],
    });
  });

  test("CORE-12: silent skip for lsp on codex (also cross-platform-only)", () => {
    // lsp has no codex equivalent either — silent skip.
    const result = expandPermissionToToolList({ lsp: "allow" }, CODEX_TOOL_MAP);
    expect(result.warnings).toEqual([]);
  });
});
