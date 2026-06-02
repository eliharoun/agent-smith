import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Platform, Target } from "./agents";
import { AgentConfigPatch } from "./agent-config";

/**
 * Parity test: gui-shared's `Target` enum must match the canonical
 * `Target` union in src/core/types.ts. When a new render target lands
 * (e.g. agents-md in v1.1.0), this test fails until gui-shared is
 * updated — preventing the GUI from silently dropping agents whose
 * `targets` include the new value.
 */
describe("Target parity with CLI core", () => {
  it("Target enum matches src/core/types.ts Target union", () => {
    const corePath = join(import.meta.dir, "../../../../src/core/types.ts");
    const coreSource = readFileSync(corePath, "utf-8");
    const match = coreSource.match(/export type Target = ([^;]+);/);
    if (!match) {
      throw new Error('src/core/types.ts must export `Target = "..." | "..." | ...`');
    }
    const coreValues = Array.from(match[1]!.matchAll(/"([^"]+)"/g))
      .map((m) => m[1]!)
      .sort();
    const guiValues: string[] = [...Target.options].sort();
    expect(guiValues).toEqual(coreValues);
  });

  it("Platform enum is the Target subset that excludes agents-md", () => {
    const platformValues: string[] = [...Platform.options].sort();
    const targetValues: string[] = [...Target.options].filter((t) => t !== "agents-md").sort();
    expect(platformValues).toEqual(targetValues);
  });

  it("AgentConfigPatch.targets accepts agents-md", () => {
    const result = AgentConfigPatch.safeParse({
      targets: ["claude-code", "agents-md"],
    });
    expect(result.success).toBe(true);
  });

  it("AgentConfigPatch.targets rejects unknown values", () => {
    const result = AgentConfigPatch.safeParse({
      targets: ["claude-code", "not-a-target"],
    });
    expect(result.success).toBe(false);
  });
});
