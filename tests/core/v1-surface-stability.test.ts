import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CanonicalConfigSchema } from "../../src/core/config-schema";
import { KnowledgeBlockSchema, KnowledgeSourceSchema } from "../../src/core/knowledge/schema";

/**
 * v1 surface stability — config schema lock.
 *
 * These tests snapshot the JSON-schema serialization of the two zod schemas
 * that define the on-disk contract for agent bundles:
 *
 *   - `CanonicalConfigSchema` — every field of an agent's `agent.config.json`.
 *   - `KnowledgeBlockSchema` + `KnowledgeSourceSchema` — every field of the
 *     `knowledge` block and every knowledge source variant.
 *
 * They are intentionally structural rather than literal-equality snapshots:
 * we assert the set of top-level required keys, the set of optional keys,
 * the set of knowledge source `type` discriminator values, and the per-
 * variant required fields. This catches:
 *
 *   1. Removing or renaming a documented field (breaks user configs).
 *   2. Promoting an optional field to required (breaks user configs).
 *   3. Adding a knowledge source variant without explicit acknowledgment
 *      (forces the maintainer to update this test, which forces a v1.x
 *      compatibility decision).
 *
 * Once v1.0.0 ships, any change here is a MAJOR version bump unless it
 * relaxes a constraint (optional fields can become more permissive; new
 * optional fields can be added; new discriminator values are minor bumps
 * but must come with migration tests).
 *
 * NOTE: maintainer-curated doc lives at `docs/v1-surface-config.md`
 * (gitignored). Update both when changing the surface intentionally.
 */

describe("v1 surface stability — CanonicalConfigSchema", () => {
  // unrepresentable: "any" — Phase 1 (2026-05-27) added a .transform() to the
  // modelTier field for alias normalization (opus → high, etc.). z.toJSONSchema
  // throws on transforms by default; "any" tells Zod to substitute {} so the
  // rest of the surface (required fields, property set, enum values) still
  // round-trips. The modelTier enum test below now reads the BEFORE-transform
  // shape directly via the schema object instead of from JSON-schema output.
  const json = z.toJSONSchema(CanonicalConfigSchema, { unrepresentable: "any" }) as {
    type: string;
    required?: string[];
    properties: Record<string, unknown>;
  };

  test("top-level required keys are exactly the v1 contract", () => {
    // These keys MUST be present in every agent.config.json.
    // Promoting an optional field into this list breaks user configs.
    // schemaVersion added 2026-05-24 per B10 (required literal=1, migration
    // injects for legacy on-disk files via parseConfig()).
    expect(new Set(json.required ?? [])).toEqual(
      new Set(["schemaVersion", "name", "description", "targets", "modelTier"]),
    );
  });

  test("top-level property set is exactly the v1 contract", () => {
    // Adding a new property is fine (forwards-compatible) but it MUST be
    // added explicitly here so the test fails until the maintainer
    // acknowledges the surface change.
    // schemaVersion added 2026-05-24 per B10.
    expect(new Set(Object.keys(json.properties))).toEqual(
      new Set([
        "schemaVersion",
        "name",
        "description",
        "targets",
        "modelTier",
        "model",
        "mode",
        "temperature",
        "color",
        "permission",
        "mcpServers",
        // `mcp` (bundle-level dependency declarations: required[]/peer[])
        // was first documented in v1.2 but the schema field itself was
        // added in v1.4.1 — before that, zod silently stripped the block
        // at parseConfig time. Optional + strict; forwards-compatible per
        // the policy in this file's header.
        "mcp",
        "skills",
        "knowledge",
        "requires",
        "platformConventions",
        // `targetOptions` (added 2026-05-31, Task 5b) is an optional
        // top-level addition — forwards-compatible per the policy in this
        // file's header. Bundles without a `targetOptions` block render
        // unchanged (each sub-key has a default).
        "targetOptions",
        "thresholds",
      ]),
    );
  });

  test("targets enum values are exactly the supported platforms", () => {
    const targets = json.properties.targets as { items: { enum: string[] } };
    expect(new Set(targets.items.enum)).toEqual(
      new Set(["opencode", "claude-code", "codex", "kiro", "agents-md"]),
    );
  });

  test("modelTier enum values are exactly the v1 tiers", () => {
    // Post-2026-05-27 Phase 1: schema accepts 7 input values (3 canonical +
    // 3 aliases + inherit) and normalizes aliases to canonical at parse time.
    // Reading the enum from JSON Schema is unreliable because of the
    // transform; read directly from the underlying Zod enum.
    // The CanonicalConfigSchema.shape.modelTier is a ZodEnum or ZodPipe wrapping
    // one. We assert the input set: aliases must remain accepted for v1
    // backward compat.
    const tierField = (
      CanonicalConfigSchema as unknown as {
        shape: { modelTier: { def?: { in?: { def?: { entries?: Record<string, string> } } } } };
      }
    ).shape.modelTier;
    const entries = tierField.def?.in?.def?.entries ?? {};
    const accepted = new Set(Object.values(entries));
    expect(accepted).toEqual(
      new Set(["high", "balanced", "fast", "opus", "sonnet", "haiku", "inherit"]),
    );
  });

  test("mode enum values are exactly the v1 modes", () => {
    const mode = json.properties.mode as { enum: string[] };
    expect(new Set(mode.enum)).toEqual(new Set(["primary", "subagent", "all"]));
  });
});

describe("v1 surface stability — KnowledgeBlockSchema", () => {
  const json = z.toJSONSchema(KnowledgeBlockSchema) as {
    type: string;
    required?: string[];
    properties: Record<string, unknown>;
  };

  test("knowledge block has no required top-level fields", () => {
    // The whole knowledge block is optional on the agent; nothing inside
    // it is required at the top level either.
    expect(json.required ?? []).toEqual([]);
  });

  test("knowledge block property set is exactly the v1 contract", () => {
    // `compile` (added 2026-05-31, knowledge-compiler v2) is an optional
    // top-level addition — forwards-compatible per the policy in this file's
    // header. Bundles without a `compile` block render in v1 mode unchanged.
    expect(new Set(Object.keys(json.properties))).toEqual(
      new Set(["packs", "inlineBudget", "sources", "compile"]),
    );
  });
});

describe("v1 surface stability — KnowledgeSourceSchema", () => {
  const json = z.toJSONSchema(KnowledgeSourceSchema) as {
    oneOf?: Array<{
      properties?: { type?: { enum?: string[]; const?: string } };
      required?: string[];
    }>;
  };

  // Helper: zod 4 emits the discriminator as either `enum: ["file"]` (single
  // value) or `const: "file"` depending on version. Read whichever is present.
  const typeOf = (variant: { properties?: { type?: { enum?: string[]; const?: string } } }) =>
    variant.properties?.type?.const ?? variant.properties?.type?.enum?.[0];

  test("discriminator 'type' values are exactly the v1 source variants", () => {
    // Every variant in the discriminated union contributes one entry to
    // oneOf with a single-value `type` field. Adding a new variant requires
    // updating this list, which forces a deliberate v1 surface decision.
    const variants = (json.oneOf ?? [])
      .map(typeOf)
      .filter((t): t is string => typeof t === "string");
    expect(new Set(variants)).toEqual(
      new Set(["file", "dir", "glob", "url", "git", "npm", "confluence", "jira"]),
    );
  });

  test("every variant requires 'id' and 'type'; non-url variants also require 'delivery'", () => {
    // BaseFields contract: id (kebab), plus the type discriminator. Every
    // variant must inherit these as required. `delivery` is required for
    // every variant except url, where it's conditional on `lazy` (lazy URL
    // sources omit delivery; eager URL sources still require it via a
    // schema refinement, which doesn't surface in JSON-Schema's `required`).
    for (const variant of json.oneOf ?? []) {
      const req = new Set(variant.required ?? []);
      expect(req.has("id")).toBe(true);
      expect(req.has("type")).toBe(true);
      const t = typeOf(variant);
      if (t !== "url") {
        expect(req.has("delivery")).toBe(true);
      }
    }
  });

  test("path-shaped variants (file, dir, glob) require 'path'", () => {
    for (const variant of json.oneOf ?? []) {
      const t = typeOf(variant);
      if (t === "file" || t === "dir" || t === "glob") {
        expect(new Set(variant.required ?? []).has("path")).toBe(true);
      }
    }
  });

  test("url-shaped variants (url, git) require 'url'", () => {
    for (const variant of json.oneOf ?? []) {
      const t = typeOf(variant);
      if (t === "url" || t === "git") {
        expect(new Set(variant.required ?? []).has("url")).toBe(true);
      }
    }
  });

  test("confluence variant requires 'space'; jira requires 'jql'; npm requires 'package'", () => {
    for (const variant of json.oneOf ?? []) {
      const req = new Set(variant.required ?? []);
      const t = typeOf(variant);
      if (t === "confluence") expect(req.has("space")).toBe(true);
      if (t === "jira") expect(req.has("jql")).toBe(true);
      if (t === "npm") expect(req.has("package")).toBe(true);
    }
  });
});
