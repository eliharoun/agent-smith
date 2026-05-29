import { describe, expect, test } from "bun:test";
import type {
  AgentBundle,
  CanonicalConfig,
  RenderedAgent,
  Source,
  SourceKind,
  Target,
} from "../../src/core/types";

describe("core/types", () => {
  test("a sample CanonicalConfig is structurally valid", () => {
    const targets: Target[] = ["opencode", "claude-code", "codex"];
    const cfg: CanonicalConfig = {
      schemaVersion: 1,
      name: "sample",
      description: "Sample agent for type checking",
      targets,
      modelTier: "balanced",
      mode: "subagent",
    };
    expect(cfg.name).toBe("sample");
    expect(cfg.targets).toHaveLength(3);
  });

  test("Source supports all three kinds", () => {
    const kinds: SourceKind[] = ["user-global", "project", "registered"];
    const sources: Source[] = kinds.map((k) => ({
      kind: k,
      rootPath: "/tmp/x",
      label: k,
    }));
    expect(sources).toHaveLength(3);
  });

  test("AgentBundle and RenderedAgent shapes compile", () => {
    const bundle: AgentBundle = {
      config: {
        schemaVersion: 1,
        name: "x",
        description: "y",
        targets: ["opencode"],
        modelTier: "inherit",
      },
      source: { kind: "user-global", rootPath: "/tmp", label: "u" },
      bundlePath: "/tmp/x",
      files: { identity: "i", expertise: "e", soul: "s", user: "u" },
    };
    const rendered: RenderedAgent = {
      target: "opencode",
      format: "markdown-frontmatter",
      relativePath: "x.md",
      frontmatter: { description: "y" },
      body: "body",
    };
    expect(bundle.config.name).toBe("x");
    if (rendered.format === "markdown-frontmatter") {
      expect(rendered.frontmatter.description).toBe("y");
    }
    expect(rendered.target).toBe("opencode");
  });

  test("RenderedAgent json variant exposes data after narrowing", () => {
    const rendered: RenderedAgent = {
      target: "codex", // any Target works structurally; the kiro target is added in Commit 2
      format: "json",
      relativePath: "x.json",
      data: { name: "x", description: "y" },
    };
    if (rendered.format === "json") {
      expect(rendered.data.name).toBe("x");
      expect(rendered.relativePath).toBe("x.json");
    }
  });
});
