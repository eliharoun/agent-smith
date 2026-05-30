import { describe, expect, test } from "bun:test";
import { parseInitAgentFlags } from "../../src/cli/parse-init-agent-flags";
import { expandPreset } from "../../src/core/permission-presets";
import { SmithError } from "../../src/core/smith-error";

/**
 * Flag-validation contract for the `smith agent init` action body.
 *
 * Fields that map onto branded canonical types (--targets, --model-tier,
 * --mode, --permission-json) used to be cast directly; a typo would
 * surface much later as a confusing schema-validation error inside
 * init-agent. We validate at the CLI boundary now so the user sees a
 * usage-error that names the offending flag.
 */
describe("cli/parseInitAgentFlags", () => {
  test("returns empty opts for empty raw record", () => {
    expect(parseInitAgentFlags({})).toEqual({});
  });

  test("passes through valid --targets, --model-tier, --mode", () => {
    const opts = parseInitAgentFlags({
      targets: "opencode,codex",
      modelTier: "balanced",
      mode: "subagent",
    });
    expect(opts.targets).toEqual(["opencode", "codex"]);
    expect(opts.modelTier).toBe("balanced");
    expect(opts.mode).toBe("subagent");
  });

  test("trims whitespace and drops empties when splitting --targets", () => {
    const opts = parseInitAgentFlags({ targets: "opencode, codex , " });
    expect(opts.targets).toEqual(["opencode", "codex"]);
  });

  test("--targets with an unknown value throws usage-error naming the flag", () => {
    let caught: unknown;
    try {
      parseInitAgentFlags({ targets: "opencode,foo" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    const msg = (sm.payload as { message: string }).message;
    expect(msg).toContain("--targets");
    expect(msg).toContain("Valid: opencode, claude-code, codex");
  });

  test("--model-tier with unknown value throws usage-error", () => {
    let caught: unknown;
    try {
      parseInitAgentFlags({ modelTier: "turbo" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    expect((sm.payload as { message: string }).message).toContain("--model-tier");
  });

  test("--mode with unknown value throws usage-error", () => {
    let caught: unknown;
    try {
      parseInitAgentFlags({ mode: "interactive" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    expect((sm.payload as { message: string }).message).toContain("--mode");
  });

  test("--permission-json with malformed JSON throws usage-error naming the flag", () => {
    let caught: unknown;
    try {
      parseInitAgentFlags({ permissionJson: "{not json" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    expect((sm.payload as { message: string }).message).toContain("--permission-json");
  });

  test("--permission-json with wrong shape throws usage-error", () => {
    // value is a number, not a permission action or per-pattern record.
    let caught: unknown;
    try {
      parseInitAgentFlags({ permissionJson: '{"read":42}' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    expect((sm.payload as { message: string }).message).toContain("--permission-json");
  });

  test("--permission-json with valid shape is parsed verbatim", () => {
    const opts = parseInitAgentFlags({
      permissionJson: '{"read":"allow","bash":"deny"}',
    });
    expect(opts.permission).toEqual({ read: "allow", bash: "deny" });
  });

  test("--permission preset expands to canonical permission config", () => {
    const opts = parseInitAgentFlags({ permission: "read-only" });
    expect(opts.permission).toEqual(expandPreset("read-only"));
  });

  test("--permission with unknown preset throws usage-error", () => {
    let caught: unknown;
    try {
      parseInitAgentFlags({ permission: "wide-open" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("usage-error");
    expect((sm.payload as { message: string }).message).toContain("--permission");
  });

  test("--permission-json takes precedence over --permission preset", () => {
    const opts = parseInitAgentFlags({
      permission: "read-only",
      permissionJson: '{"bash":"ask"}',
    });
    expect(opts.permission).toEqual({ bash: "ask" });
  });

  test("passes through scalar/array fields unchanged", () => {
    const opts = parseInitAgentFlags({
      description: "Reviews code carefully",
      mcpServers: "fs,git",
      skills: "tdd,debugging",
    });
    expect(opts.description).toBe("Reviews code carefully");
    expect(opts.mcpServers).toEqual(["fs", "git"]);
    expect(opts.skills).toEqual(["tdd", "debugging"]);
  });

  test("--requires-skills parses bare names and catalog/name pairs", () => {
    const opts = parseInitAgentFlags({
      requiresSkills: "tdd, official/debugging , ",
    });
    expect(opts.requiresSkills).toEqual([
      { name: "tdd" },
      { catalog: "official", name: "debugging" },
    ]);
  });
});
