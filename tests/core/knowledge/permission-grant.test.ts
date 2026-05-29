import { describe, expect, it } from "bun:test";
import {
  injectByTargetIntoFrontmatter,
  injectKnowledgeIntoRender,
} from "../../../src/core/knowledge/permission-grant";
import type { RenderedAgent } from "../../../src/core/types";

const dir = "/h/.config/agent-smith/agents/x/knowledge";

function makeMarkdownRender(
  target: "opencode" | "claude-code" | "codex",
  frontmatter: Record<string, unknown> = {},
): RenderedAgent {
  return {
    target,
    format: "markdown-frontmatter",
    relativePath: target === "codex" ? "x/SKILL.md" : "x.md",
    frontmatter,
    body: "",
  };
}

describe("injectKnowledgeIntoRender", () => {
  it("returns rendered unchanged when knowledgeDir is undefined", () => {
    const r = makeMarkdownRender("opencode", { permission: { read: "deny" as const } });
    const out = injectKnowledgeIntoRender(r, undefined);
    expect(out).toBe(r);
  });

  it("opencode markdown branch: injects permission.read for the dir glob", () => {
    const r = makeMarkdownRender("opencode");
    const out = injectKnowledgeIntoRender(r, dir);
    if (out.format !== "markdown-frontmatter") throw new Error("expected markdown-frontmatter");
    const perm = out.frontmatter.permission as { read: Record<string, string> };
    expect(perm.read[`${dir}/**`]).toBe("allow");
  });

  it("claude-code markdown branch: appends to additionalDirectories", () => {
    const r = makeMarkdownRender("claude-code");
    const out = injectKnowledgeIntoRender(r, dir);
    if (out.format !== "markdown-frontmatter") throw new Error("expected markdown-frontmatter");
    expect(out.frontmatter.additionalDirectories).toEqual([dir]);
  });

  it("codex markdown branch: appends to allowed_external_directories", () => {
    const r = makeMarkdownRender("codex");
    const out = injectKnowledgeIntoRender(r, dir);
    if (out.format !== "markdown-frontmatter") throw new Error("expected markdown-frontmatter");
    expect(out.frontmatter.allowed_external_directories).toEqual([dir]);
  });
});

// Inner per-target helper retained for fine-grained unit coverage. The kiro
// branch (added in Commit 2) lives in injectKnowledgeIntoRender's json
// dispatch, not here — this helper is markdown-only.
describe("injectByTargetIntoFrontmatter (inner helper)", () => {
  it("opencode: adds a path-pattern allow under permission.read", () => {
    const fm = {};
    const out = injectByTargetIntoFrontmatter("opencode", fm, dir);
    const perm = out.permission as { read: Record<string, string> };
    expect(perm.read[`${dir}/**`]).toBe("allow");
  });

  it("opencode: merges with existing permission.read", () => {
    const fm = { permission: { read: { "/foo/**": "deny" as const } } };
    const out = injectByTargetIntoFrontmatter("opencode", fm, dir);
    const perm = out.permission as { read: Record<string, string> };
    expect(perm.read["/foo/**"]).toBe("deny");
    expect(perm.read[`${dir}/**`]).toBe("allow");
  });

  it("opencode: converts a bare deny to a pattern record + adds the knowledge allow", () => {
    const fm = { permission: { read: "deny" as const } };
    const out = injectByTargetIntoFrontmatter("opencode", fm, dir);
    const perm = out.permission as { read: Record<string, string> };
    expect(perm.read["**"]).toBe("deny");
    expect(perm.read[`${dir}/**`]).toBe("allow");
  });

  it("claude-code: adds the dir to additionalDirectories", () => {
    const fm = {};
    const out = injectByTargetIntoFrontmatter("claude-code", fm, dir);
    expect(out.additionalDirectories).toEqual([dir]);
  });

  it("claude-code: appends without duplicates", () => {
    const fm = { additionalDirectories: ["/a", dir] };
    const out = injectByTargetIntoFrontmatter("claude-code", fm, dir);
    expect(out.additionalDirectories).toEqual(["/a", dir]);
  });

  it("codex: adds the dir to allowed_external_directories", () => {
    const fm = {};
    const out = injectByTargetIntoFrontmatter("codex", fm, dir);
    expect(out.allowed_external_directories).toEqual([dir]);
  });
});
