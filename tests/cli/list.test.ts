import { describe, expect, test } from "bun:test";
import { runListCli } from "../../src/cli/commands/list";
import { fakeBundle } from "../_helpers/fakeBundle";

const FAKE_PATHS = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
  "agents-md": "/fake/agents-md/agents",
};

describe("cli/list runListCli install-state markers", () => {
  test("shows ✓ for installed targets and ✗ for not-installed", async () => {
    const messages: string[] = [];
    const bundle = fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] });

    const code = await runListCli({
      paths: FAKE_PATHS,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }),
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      statFile: async (p: string) => {
        if (p === "/fake/opencode/agents/foo.md") return {};
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      print: (m) => messages.push(m),
      printErr: () => {},
    });

    expect(code).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("foo");
    expect(messages[0]).toContain("opencode ✓");
    expect(messages[0]).toContain("claude-code ✗");
    expect(messages[0]).toContain("codex ✗");
  });

  test("codex install state checks the SKILL.md path inside per-agent dir", async () => {
    const messages: string[] = [];
    const bundle = fakeBundle("bar", { targets: ["codex"] });

    await runListCli({
      paths: FAKE_PATHS,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }),
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      statFile: async (p: string) => {
        if (p === "/fake/agents/skills/bar/SKILL.md") return {};
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      print: (m) => messages.push(m),
      printErr: () => {},
    });

    expect(messages[0]).toContain("codex ✓");
  });

  test("prints '(no agents found in any catalog)' when registry is empty", async () => {
    const messages: string[] = [];

    const code = await runListCli({
      paths: FAKE_PATHS,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }),
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: (m) => messages.push(m),
      printErr: () => {},
    });

    expect(code).toBe(0);
    expect(messages.some((m) => m.includes("no agents found"))).toBe(true);
  });

  test("multi-bundle output shows one line per bundle with mixed states", async () => {
    const messages: string[] = [];
    const bundles = [
      fakeBundle("alpha", { targets: ["opencode"] }),
      fakeBundle("beta", { targets: ["opencode", "codex"] }),
    ];

    await runListCli({
      paths: FAKE_PATHS,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }),
      loadAllBundles: async () => ({ bundles, failures: [] }),
      statFile: async (p: string) => {
        if (p === "/fake/opencode/agents/alpha.md") return {};
        if (p === "/fake/agents/skills/beta/SKILL.md") return {};
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      print: (m) => messages.push(m),
      printErr: () => {},
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("alpha");
    expect(messages[0]).toContain("opencode ✓");
    expect(messages[1]).toContain("beta");
    expect(messages[1]).toContain("opencode ✗");
    expect(messages[1]).toContain("codex ✓");
  });

  test("renders source.label alongside kind so synthetic agent-smith-self is identifiable", async () => {
    const messages: string[] = [];
    const bundle = fakeBundle("agent-smith", { targets: ["opencode"], kind: "registered" });
    bundle.source.label = "agent-smith-self";

    await runListCli({
      paths: FAKE_PATHS,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }),
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      statFile: async () => ({}),
      print: (m) => messages.push(m),
      printErr: () => {},
    });

    expect(messages[0]).toContain("agent-smith-self");
    expect(messages[0]).toContain("registered");
  });
});
