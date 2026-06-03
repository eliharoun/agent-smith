import { describe, it, expect } from "bun:test";
import { preflightMcp } from "../../../src/cli/commands/agent/preflight-mcp";

describe("preflightMcp", () => {
  it("returns empty arrays when mcp block is absent", () => {
    const r = preflightMcp({}, {});
    expect(r.requiredMissing).toEqual([]);
    expect(r.peerMissing).toEqual([]);
  });

  it("returns empty arrays when both lists are empty", () => {
    const r = preflightMcp({ required: [], peer: [] }, {});
    expect(r.requiredMissing).toEqual([]);
    expect(r.peerMissing).toEqual([]);
  });

  it("flags required servers absent from available", () => {
    const r = preflightMcp(
      { required: ["a", "b"], peer: ["c"] },
      { a: { command: "x" } },
    );
    expect(r.requiredMissing).toEqual(["b"]);
    expect(r.peerMissing).toEqual(["c"]);
  });

  it("returns nothing missing when all are present", () => {
    const r = preflightMcp(
      { required: ["a"], peer: ["b"] },
      { a: { command: "x" }, b: { command: "y" } },
    );
    expect(r.requiredMissing).toEqual([]);
    expect(r.peerMissing).toEqual([]);
  });

  it("preserves insertion order of declared servers in the missing arrays", () => {
    const r = preflightMcp(
      { required: ["b", "a", "c"] },
      { a: { command: "x" } },
    );
    expect(r.requiredMissing).toEqual(["b", "c"]);
  });

  it("treats undefined required/peer as empty", () => {
    const r = preflightMcp({}, { a: { command: "x" } });
    expect(r.requiredMissing).toEqual([]);
    expect(r.peerMissing).toEqual([]);
  });
});
