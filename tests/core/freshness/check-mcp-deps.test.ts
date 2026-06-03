import { describe, expect, it } from "bun:test";
import { checkMcpDeps } from "../../../src/core/freshness/check-mcp-deps";

describe("checkMcpDeps", () => {
  it("returns no findings when every required and peer is present", async () => {
    const findings = await checkMcpDeps({
      installedAgents: [{ name: "a", mcp: { required: ["x"], peer: ["y"] } }],
      readAvailable: async () => ({
        x: { command: "/x" },
        y: { command: "/y" },
      }),
    });
    expect(findings).toEqual([]);
  });

  it("emits an error finding for missing required", async () => {
    const findings = await checkMcpDeps({
      installedAgents: [{ name: "a", mcp: { required: ["x"] } }],
      readAvailable: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.agent).toBe("a");
    expect(findings[0]?.server).toBe("x");
    expect(findings[0]?.kind).toBe("required");
  });

  it("emits a warning finding for missing peer", async () => {
    const findings = await checkMcpDeps({
      installedAgents: [{ name: "a", mcp: { peer: ["y"] } }],
      readAvailable: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.kind).toBe("peer");
    expect(findings[0]?.agent).toBe("a");
    expect(findings[0]?.server).toBe("y");
  });

  it("returns one finding per (agent, server) pair in deterministic order", async () => {
    const findings = await checkMcpDeps({
      installedAgents: [
        { name: "a", mcp: { required: ["x", "y"] } },
        { name: "b", mcp: { required: ["x"] } },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => `${f.agent}:${f.server}:${f.kind}`)).toEqual([
      "a:x:required",
      "a:y:required",
      "b:x:required",
    ]);
  });

  it("ignores agents with no mcp block", async () => {
    const findings = await checkMcpDeps({
      installedAgents: [{ name: "a", mcp: undefined }, { name: "b" }],
      readAvailable: async () => ({}),
    });
    expect(findings).toEqual([]);
  });
});
