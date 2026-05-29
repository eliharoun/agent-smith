// Kiro contract test: shape assertions only, NOT full schema validation.
// The canonical schema's resources field constrains URIs to ^(file://)
// but the runtime accepts skill:// (per kiro.dev/docs/cli/custom-agents).
// Smith emits skill:// when permission.skill is set; the doctor's
// `kiro-cli agent validate --path` shell-out (Task 2.8) is the runtime
// ground truth. The vendored schema stays for documentation and drift
// detection; this contract test does not enforce a stricter constraint
// than the runtime accepts.
//
// Parallel to tests/contract/codex-shape.test.ts and claude-code-shape.test.ts.

import { describe, expect, test } from "bun:test";
import { translateKiro } from "../../src/core/translators/kiro";
import { expandPreset } from "../../src/core/permission-presets";
import type { CanonicalConfig } from "../../src/core/types";

const ALLOWED_KEYS = new Set([
  "$schema",
  "name",
  "description",
  "prompt",
  "model",
  "tools",
  "allowedTools",
  "resources",
  "hooks",
]);

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "Reviews code carefully and proactively",
    targets: ["kiro"],
    modelTier: "balanced",
    ...overrides,
  };
}

function assertKiroShape(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    expect(ALLOWED_KEYS.has(key)).toBe(true);
  }
  expect(typeof data.$schema).toBe("string");
  expect(typeof data.name).toBe("string");
  expect(typeof data.description).toBe("string");
  expect(typeof data.prompt).toBe("string");
  if ("tools" in data) {
    expect(Array.isArray(data.tools)).toBe(true);
    for (const t of data.tools as unknown[]) expect(typeof t).toBe("string");
  }
  if ("allowedTools" in data) {
    expect(Array.isArray(data.allowedTools)).toBe(true);
    for (const t of data.allowedTools as unknown[]) expect(typeof t).toBe("string");
  }
  if ("resources" in data) {
    expect(Array.isArray(data.resources)).toBe(true);
    for (const r of data.resources as unknown[]) {
      expect(typeof r).toBe("string");
      // Either file:// or skill:// — both runtime-accepted, only file:// in
      // the canonical schema (see data/kiro.agent-v1.schema.meta.json
      // knownDivergences for the documented runtime/schema gap).
      expect((r as string).match(/^(file|skill):\/\//)).toBeTruthy();
    }
  }
  if ("hooks" in data) {
    expect(typeof data.hooks).toBe("object");
    const hooks = data.hooks as Record<string, unknown>;
    if ("agentSpawn" in hooks) {
      expect(Array.isArray(hooks.agentSpawn)).toBe(true);
      for (const h of hooks.agentSpawn as Array<Record<string, unknown>>) {
        expect(typeof h.command).toBe("string");
      }
    }
  }
}

function dataOf(out: ReturnType<typeof translateKiro>): Record<string, unknown> {
  if (out.format !== "json") throw new Error(`expected json, got ${out.format}`);
  return out.data;
}

describe("contract: kiro JSON shape", () => {
  test("minimal config", () => {
    const out = translateKiro(fixture(), "body", { resolvedModel: undefined });
    assertKiroShape(dataOf(out));
  });

  test("read-only preset", () => {
    const out = translateKiro(fixture({ permission: expandPreset("read-only") }), "body", {
      resolvedModel: undefined,
    });
    assertKiroShape(dataOf(out));
  });

  test("read-edit preset", () => {
    const out = translateKiro(fixture({ permission: expandPreset("read-edit") }), "body", {
      resolvedModel: undefined,
    });
    assertKiroShape(dataOf(out));
  });

  test("full preset", () => {
    const out = translateKiro(fixture({ permission: expandPreset("full") }), "body", {
      resolvedModel: undefined,
    });
    assertKiroShape(dataOf(out));
  });

  test("with model + skill:allow + refresh hook", () => {
    const out = translateKiro(
      fixture({
        permission: { ...expandPreset("read-edit"), skill: "allow" },
        knowledge: {
          sources: [
            {
              id: "live",
              type: "url",
              url: "https://x",
              delivery: "file",
              refresh: { mode: "session" },
            },
          ],
        },
      }),
      "body",
      { resolvedModel: "claude-sonnet-4.6", withRefreshHooks: true },
    );
    assertKiroShape(dataOf(out));
  });
});
