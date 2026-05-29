import { describe, expect, it } from "bun:test";
import { renderUninstallTable } from "../../../src/cli/render/uninstall-table";
import type { UninstallPlan } from "../../../src/io/uninstaller";

describe("renderUninstallTable", () => {
  function plan(overrides: Partial<UninstallPlan> = {}): UninstallPlan {
    return {
      bundleName: "alpha",
      targets: [
        { target: "opencode", path: "/u/.config/opencode/agents/alpha.md", exists: true },
        { target: "claude-code", path: "/u/.claude/agents/alpha.md", exists: false },
      ],
      knowledge: {
        bundleName: "alpha",
        knowledgeDir: "/u/.config/agent-smith/knowledge/alpha",
        exists: true,
      },
      ...overrides,
    };
  }

  it("renders one row per target plus a knowledge row", () => {
    const lines = renderUninstallTable([plan()]);
    const joined = lines.join("\n");

    expect(joined).toContain("opencode");
    expect(joined).toContain("installed");
    expect(joined).toContain("→ remove");
    expect(joined).toContain("claude-code");
    expect(joined).toContain("not installed");
    expect(joined).toContain("skip");
    expect(joined).toContain("knowledge");
  });

  it('renders knowledge row with "unknown" status when exists is "unknown"', () => {
    const p = plan({
      knowledge: {
        bundleName: "alpha",
        knowledgeDir: "/u/.config/agent-smith/knowledge/alpha",
        exists: "unknown",
        planError: "EACCES: permission denied",
      },
    });
    const lines = renderUninstallTable([p]);
    const joined = lines.join("\n");

    expect(joined).toContain("knowledge");
    expect(joined).toContain("unknown");
    expect(joined).toContain("skip");
  });

  it("supports a header per bundle when given multiple plans", () => {
    const lines = renderUninstallTable(
      [plan({ bundleName: "alpha" }), plan({ bundleName: "beta" })],
      { perBundleHeader: true },
    );
    const joined = lines.join("\n");

    expect(joined).toContain('"alpha"');
    expect(joined).toContain('"beta"');
  });

  it("uses custom verb when provided (for destroy-agent)", () => {
    const lines = renderUninstallTable([plan()], { verbForExisting: "→ destroy" });
    const joined = lines.join("\n");

    expect(joined).toContain("→ destroy");
    expect(joined).not.toContain("→ remove");
  });
});
