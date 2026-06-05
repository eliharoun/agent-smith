import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPendingHint } from "../../src/cli/pending-hint";
import { recordPendingOp } from "../../src/io/pending-ops";

describe("renderPendingHint", () => {
  it("returns empty when no pending ops match detected platforms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ph-"));
    const hint = await renderPendingHint({
      stateHome: dir,
      installedPlatforms: new Set(["claude-code"]),
    });
    expect(hint).toBe("");
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a one-liner when a pending op matches a newly-detected platform", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ph-"));
    await recordPendingOp(dir, {
      schemaVersion: 1,
      agent: "x",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    const hint = await renderPendingHint({
      stateHome: dir,
      installedPlatforms: new Set(["claude-code", "codex"]),
    });
    expect(hint).toContain("codex");
    expect(hint).toContain("pending");
    await rm(dir, { recursive: true, force: true });
  });

  it("only fires once per platform even with multiple pending ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ph-"));
    await recordPendingOp(dir, {
      schemaVersion: 1,
      agent: "a",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    await recordPendingOp(dir, {
      schemaVersion: 1,
      agent: "b",
      command: "agent.install",
      platform: "codex",
      queuedAt: "2026-06-04T10:00:00Z",
      manifestTargetAtQueue: ["codex"],
    });
    const hint = await renderPendingHint({
      stateHome: dir,
      installedPlatforms: new Set(["claude-code", "codex"]),
    });
    expect((hint.match(/codex/g) ?? []).length).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
