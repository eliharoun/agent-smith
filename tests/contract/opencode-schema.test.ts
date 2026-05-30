import { describe, expect, test } from "bun:test";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../data/opencode.config.schema.json" with { type: "json" };
import { expandPreset } from "../../src/core/permission-presets";
import { translateOpenCode } from "../../src/core/translators/opencode";
import type { CanonicalConfig } from "../../src/core/types";

/**
 * Contract test: opencode frontmatter must validate against the vendored
 * schema fetched from https://opencode.ai/config.json.
 *
 * The published schema describes the WHOLE opencode config. Per-agent shape
 * lives at `$defs.AgentConfig` (the AgentConfig sub-schema). The agent NAME
 * is the map key in the parent `agent` object, so it doesn't appear in the
 * sub-schema — and the opencode translator correctly omits it from frontmatter.
 *
 * Two adjustments to the loaded schema before compile:
 * 1. Strip remote `$ref`s (e.g. https://models.dev/...). Ajv refuses to
 *    compile schemas with unresolved external refs; we don't want to fetch
 *    them in tests, and the sibling `type: "string"` already constrains the
 *    field adequately for our contract.
 * 2. Use ajv's 2020-12 build (the schema declares draft 2020-12).
 *
 * Schema shape note: the vendored schema uses a `$defs`-based structure with
 * a top-level `$ref` to `#/$defs/Config`. Other `$defs` entries (e.g.
 * `PermissionConfig`) are referenced internally from `AgentConfig`, so we
 * register the whole schema with ajv (so refs resolve) and compile against
 * the `#/$defs/AgentConfig` URI rather than passing a plucked sub-schema.
 */

// biome-ignore lint/suspicious/noExplicitAny: schema mutation helper
function stripRemoteRefs(node: any): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripRemoteRefs(item);
    return;
  }
  if (typeof node.$ref === "string" && /^https?:\/\//.test(node.$ref)) {
    delete node.$ref;
  }
  for (const key of Object.keys(node)) stripRemoteRefs(node[key]);
}

// biome-ignore lint/suspicious/noExplicitAny: schema is loaded as JSON
const cloned = JSON.parse(JSON.stringify(schema)) as any;
stripRemoteRefs(cloned);
// Give the schema a stable $id so we can reference its $defs entries by URI.
const SCHEMA_ID = "https://agent-smith.test/opencode-schema.json";
cloned.$id = SCHEMA_ID;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(cloned);
const rawValidate = ajv.getSchema(`${SCHEMA_ID}#/$defs/AgentConfig`);
if (!rawValidate) {
  throw new Error("opencode schema contract: $defs.AgentConfig not found in vendored schema");
}
const validate = rawValidate;

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "test-agent",
    description: "Reviews code carefully and proactively",
    targets: ["opencode"],
    modelTier: "balanced",
    ...overrides,
  };
}

function fm(out: ReturnType<typeof translateOpenCode>): Record<string, unknown> {
  if (out.format !== "markdown-frontmatter") {
    throw new Error(`expected markdown-frontmatter, got ${out.format}`);
  }
  return out.frontmatter;
}

function check(out: ReturnType<typeof translateOpenCode>): void {
  const frontmatter = fm(out);
  const ok = validate(frontmatter);
  if (!ok) {
    console.error("Schema errors:", validate.errors);
    console.error("Frontmatter:", JSON.stringify(frontmatter, null, 2));
  }
  expect(ok).toBe(true);
}

describe("contract: opencode frontmatter validates against vendored schema", () => {
  test("1. minimal config", () => {
    const out = translateOpenCode(fixture(), "body", { resolvedModel: undefined });
    check(out);
  });

  test("2. with read-only preset", () => {
    const out = translateOpenCode(fixture({ permission: expandPreset("read-only") }), "body", { resolvedModel: undefined });
    check(out);
  });

  test("3. with read-edit preset", () => {
    const out = translateOpenCode(fixture({ permission: expandPreset("read-edit") }), "body", { resolvedModel: undefined });
    check(out);
  });

  test("4. with full preset", () => {
    const out = translateOpenCode(fixture({ permission: expandPreset("full") }), "body", { resolvedModel: undefined });
    check(out);
  });

  test("5. with pattern-based bash permission", () => {
    const out = translateOpenCode(
      fixture({ permission: { bash: { "git *": "allow", "*": "deny" } } }),
      "body",
      { resolvedModel: undefined },
    );
    check(out);
  });

  test("6. with mode/temperature/color (theme color)", () => {
    // Schema accepts theme color names OR hex `#rrggbb`. Use a theme color.
    const out = translateOpenCode(
      fixture({ mode: "subagent", temperature: 0.4, color: "primary" }),
      "body",
      { resolvedModel: undefined },
    );
    check(out);
  });

  test("7. with edit:'ask'", () => {
    const out = translateOpenCode(fixture({ permission: { edit: "ask" } }), "body", { resolvedModel: undefined });
    check(out);
  });

  test("8. kitchen sink: presets + custom pattern + all opencode-specific fields", () => {
    const out = translateOpenCode(
      fixture({
        mode: "subagent",
        temperature: 0.5,
        color: "#a020f0",
        permission: {
          read: "allow",
          edit: "ask",
          bash: { "git *": "allow", "*": "deny" },
        },
      }),
      "body",
      { resolvedModel: undefined },
    );
    check(out);
  });
});
