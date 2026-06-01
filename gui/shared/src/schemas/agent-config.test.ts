import { describe, expect, it } from "bun:test";
import { AgentConfigPatch, ModelTier } from "./agent-config";

describe("ModelTier", () => {
  it("accepts the four canonical tiers", () => {
    for (const t of ["high", "balanced", "fast", "inherit"]) {
      expect(ModelTier.safeParse(t).success).toBe(true);
    }
  });
  it("rejects aliases and unknowns (GUI normalizes aliases before saving)", () => {
    expect(ModelTier.safeParse("opus").success).toBe(false);
    expect(ModelTier.safeParse("ultra").success).toBe(false);
  });
});

describe("AgentConfigPatch", () => {
  it("accepts a targets-only patch", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["opencode", "kiro"] }).success).toBe(true);
  });
  it("accepts a modelTier-only patch", () => {
    expect(AgentConfigPatch.safeParse({ modelTier: "balanced" }).success).toBe(true);
  });
  it("accepts both fields together", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["codex"], modelTier: "fast" }).success).toBe(
      true,
    );
  });
  it("rejects an empty patch", () => {
    expect(AgentConfigPatch.safeParse({}).success).toBe(false);
  });
  it("rejects an empty targets array", () => {
    expect(AgentConfigPatch.safeParse({ targets: [] }).success).toBe(false);
  });
  it("rejects an invalid platform", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["vscode"] }).success).toBe(false);
  });
  it("rejects an unknown modelTier", () => {
    expect(AgentConfigPatch.safeParse({ modelTier: "ultra" }).success).toBe(false);
  });

  // ─── knowledge patch (Task v2.1-C) ────────────────────────────────────
  it("accepts a knowledge-only patch (permissive object)", () => {
    const patch = {
      knowledge: {
        sources: [{ id: "docs", type: "url", url: "https://x.test/", delivery: "auto" }],
      },
    };
    expect(AgentConfigPatch.safeParse(patch).success).toBe(true);
  });
  it("accepts knowledge alongside targets+modelTier", () => {
    const patch = {
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: { sources: [] },
    };
    expect(AgentConfigPatch.safeParse(patch).success).toBe(true);
  });
  it("accepts an empty knowledge object (server enforces canonical shape)", () => {
    expect(AgentConfigPatch.safeParse({ knowledge: {} }).success).toBe(true);
  });
  it("rejects a knowledge value that is not an object", () => {
    expect(AgentConfigPatch.safeParse({ knowledge: "nope" }).success).toBe(false);
    expect(AgentConfigPatch.safeParse({ knowledge: ["a", "b"] }).success).toBe(false);
  });

  // ─── mcpServers patch (Task v2.1-D) ───────────────────────────────────
  // The canonical CLI schema types `mcpServers` as a string array of server
  // *names*; the spawn config lives in the user's AI-client global MCP
  // config, not in the bundle. The earlier regression accepted the object
  // map shape and produced bundles that failed `smith agent validate`.
  it("accepts an mcpServers patch with a single canonical entry", () => {
    expect(AgentConfigPatch.safeParse({ mcpServers: ["agent-smith-knowledge"] }).success).toBe(
      true,
    );
  });
  it("accepts an mcpServers patch with multiple entries", () => {
    expect(
      AgentConfigPatch.safeParse({
        mcpServers: ["agent-smith-knowledge", "github-mcp"],
      }).success,
    ).toBe(true);
  });
  it("accepts an empty mcpServers array (toggle-OFF result with no other entries)", () => {
    expect(AgentConfigPatch.safeParse({ mcpServers: [] }).success).toBe(true);
  });
  it("accepts mcpServers alongside targets/modelTier/knowledge", () => {
    const patch = {
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: { sources: [] },
      mcpServers: ["agent-smith-knowledge"],
    };
    expect(AgentConfigPatch.safeParse(patch).success).toBe(true);
  });
  it("rejects the AI-client-style object map (regression: this was the bug)", () => {
    expect(
      AgentConfigPatch.safeParse({
        mcpServers: {
          "agent-smith-knowledge": { command: "smith", args: [] },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects an mcpServers value that is not an array", () => {
    expect(AgentConfigPatch.safeParse({ mcpServers: "nope" }).success).toBe(false);
    expect(AgentConfigPatch.safeParse({ mcpServers: 42 }).success).toBe(false);
  });
  it("rejects an mcpServers array containing empty-string entries", () => {
    expect(AgentConfigPatch.safeParse({ mcpServers: [""] }).success).toBe(false);
    expect(AgentConfigPatch.safeParse({ mcpServers: ["agent-smith-knowledge", ""] }).success).toBe(
      false,
    );
  });
});
