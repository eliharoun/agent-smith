import type { AgentBundle, SourceKind, Target } from "../../src/core/types";

/**
 * Test fixture builder for AgentBundle.
 *
 * Returns a properly typed bundle (no `as any`). Override any field via opts.
 * Defaults: sonnet tier, opencode-only target, user-global source at /fake.
 *
 * Used across IO/CLI tests. Add fields here rather than reaching for `as any`
 * in individual test files.
 *
 * GOTCHA: this helper builds the `AgentBundle` directly without routing
 * through `parseConfig`. That is intentional — most tests want a typed
 * fixture, not to exercise the schema. But it also means real round-trip
 * behavior (schema preservation, normalization, default-application,
 * unknown-key stripping) is NOT exercised by tests using this helper.
 *
 * If you are adding a NEW field to CanonicalConfig (e.g. `mcp.required[]`),
 * verify it survives a parseConfig round-trip in tests/core/config-schema.test.ts
 * BEFORE relying on it here. A schema that silently drops the field will
 * compile cleanly through this helper while every production consumer
 * sees `undefined` at runtime — the v1.4.0 mcp.required/peer drift was
 * invisible for exactly that reason.
 */
export interface FakeBundleOpts {
  kind?: SourceKind;
  targets?: Target[];
  description?: string;
  rootPath?: string;
  bundlePath?: string;
  identity?: string;
  expertise?: string;
  soul?: string;
  user?: string;
  /** Optional `mcp:` block (required[]/peer[]) for preflight tests. */
  mcp?: { required?: string[]; peer?: string[] };
}

export function fakeBundle(name: string, opts: FakeBundleOpts = {}): AgentBundle {
  const kind = opts.kind ?? "user-global";
  const rootPath = opts.rootPath ?? "/fake/source";
  return {
    config: {
      schemaVersion: 1,
      name,
      description: opts.description ?? "Use to test things.",
      targets: opts.targets ?? ["opencode"],
      modelTier: "balanced",
      ...(opts.mcp ? { mcp: opts.mcp } : {}),
    },
    source: { kind, rootPath, label: kind },
    bundlePath: opts.bundlePath ?? `${rootPath}/${name}`,
    files: {
      identity: opts.identity ?? "You exist.",
      expertise: opts.expertise ?? "You do.",
      soul: opts.soul ?? "You speak.",
      user: opts.user ?? "You note.",
    },
  };
}
