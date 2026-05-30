import type { AgentBundle, SourceKind, Target } from "../../src/core/types";

/**
 * Test fixture builder for AgentBundle.
 *
 * Returns a properly typed bundle (no `as any`). Override any field via opts.
 * Defaults: sonnet tier, opencode-only target, user-global source at /fake.
 *
 * Used across IO/CLI tests. Add fields here rather than reaching for `as any`
 * in individual test files.
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
