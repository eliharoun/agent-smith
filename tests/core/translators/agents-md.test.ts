import { describe, expect, it } from "bun:test";
import { translateAgentsMd } from "../../../src/core/translators/agents-md";
import type { CanonicalConfig } from "../../../src/core/types";

const cfg = (overrides: Partial<CanonicalConfig> = {}): CanonicalConfig => ({
  schemaVersion: 1,
  name: "demo",
  description: "Reviews PRs for type-safety.",
  targets: ["agents-md"],
  modelTier: "balanced",
  ...overrides,
});

describe("translateAgentsMd", () => {
  it("emits markdown with no frontmatter", () => {
    const r = translateAgentsMd(cfg(), "BODY", { resolvedModel: undefined });
    expect(r.format).toBe("markdown-frontmatter");
    if (r.format !== "markdown-frontmatter") throw new Error("unreachable");
    expect(Object.keys(r.frontmatter).length).toBe(0);
    expect(r.body).toContain("# demo");
    expect(r.body).toContain("BODY");
  });

  it("relativePath defaults to AGENTS.md at the repo root", () => {
    const r = translateAgentsMd(cfg(), "BODY", { resolvedModel: undefined });
    expect(r.relativePath).toBe("AGENTS.md");
  });

  it("respects targetOptions.agentsMd.path override", () => {
    const r = translateAgentsMd(
      cfg({
        targetOptions: { agentsMd: { path: "docs/AGENTS.md" } },
      } as unknown as Partial<CanonicalConfig>),
      "BODY",
      { resolvedModel: undefined },
    );
    expect(r.relativePath).toBe("docs/AGENTS.md");
  });
});
