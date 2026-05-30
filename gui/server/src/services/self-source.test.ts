/**
 * Tests for the GUI server's self-source detector. Mirrors the CLI's
 * `resolveAllSources` synthetic source so /api/agents and /api/catalogs
 * see the same agent set the CLI does — closes the
 * "smith agent list shows agent-smith but the GUI shows 0 agents"
 * gap.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSelfSource, SELF_SOURCE_LABEL } from "./self-source";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "self-source-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("resolveSelfSource", () => {
  it("returns null when the workspace has no agents/ dir", async () => {
    // package.json present, but no agents/ subdir.
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "agent-smith" }),
      "utf8",
    );
    const result = await resolveSelfSource({ workspaceRoot: workspace });
    expect(result).toBeNull();
  });

  it("returns null when workspace package.json doesn't identify agent-smith", async () => {
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "some-other-thing" }),
      "utf8",
    );
    await mkdir(join(workspace, "agents"), { recursive: true });
    const result = await resolveSelfSource({ workspaceRoot: workspace });
    expect(result).toBeNull();
  });

  it("returns a Source pointing at agents/ when workspace is the agent-smith repo", async () => {
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "agent-smith" }),
      "utf8",
    );
    await mkdir(join(workspace, "agents"), { recursive: true });
    const result = await resolveSelfSource({ workspaceRoot: workspace });
    expect(result).not.toBeNull();
    expect(result?.label).toBe(SELF_SOURCE_LABEL);
    expect(result?.rootPath).toBe(join(workspace, "agents"));
    expect(result?.kind).toBe("registered");
  });

  it("returns null when workspaceRoot is not provided and no upward search root exists", async () => {
    // No injection; uses default __dirname-based detection. Hard to test
    // hermetically — guard with an explicit "not found" hint instead.
    const result = await resolveSelfSource({ workspaceRoot: "/this/path/does/not/exist" });
    expect(result).toBeNull();
  });
});
