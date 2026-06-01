import { describe, expect, test } from "bun:test";
import { renderForTargets } from "../../../src/core/translators";
import type { CanonicalConfig, RenderedAgent } from "../../../src/core/types";

/** Narrow a rendered output to its markdown-frontmatter variant. */
function md(r: RenderedAgent | undefined): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!r) throw new Error("rendered agent missing for target");
  if (r.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${r.format}`);
  }
  return r;
}

describe("renderForTargets — knowledge grant injection", () => {
  const config: CanonicalConfig = {
    schemaVersion: 1,
    name: "x",
    description: "Use to test.",
    targets: ["opencode", "claude-code", "codex"],
    modelTier: "balanced",
  };
  const dir = "/h/.config/agent-smith/agents/x/knowledge";
  const out = renderForTargets(
    config,
    "body",
    { opencode: undefined, "claude-code": undefined, codex: undefined, kiro: undefined, "agents-md": undefined },
    dir,
  );

  test("opencode frontmatter gets permission.read pattern", () => {
    const oc = md(out.find((r) => r.target === "opencode"));
    expect(((oc.frontmatter.permission as { read: Record<string, string> }).read)[`${dir}/**`]).toBe("allow");
  });

  test("claude-code frontmatter gets additionalDirectories", () => {
    const cc = md(out.find((r) => r.target === "claude-code"));
    expect(cc.frontmatter.additionalDirectories).toContain(dir);
  });

  test("codex frontmatter gets allowed_external_directories", () => {
    const cx = md(out.find((r) => r.target === "codex"));
    expect(cx.frontmatter.allowed_external_directories).toContain(dir);
  });
});
