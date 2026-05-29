import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import type { Source } from "../core/types";
import { atomicWriteJson } from "./atomic-write";
import { getOriginRemote } from "./git";
import { stateHome } from "./state-home";
import { pathExists, resolveWorkspacePath } from "./workspace-version";
import { isDebug } from "../cli/debug-flag";

/**
 * The AGENT registry document. Persisted at
 * `~/.config/agent-smith/registry.json`. See `Source` in
 * `src/core/types.ts` for the conceptual model and the parallel skill
 * registry.
 *
 * Schema-version history:
 *   - v1 [B11.1]: `schemaVersion: 1` was renamed from `version: 1`.
 *   - v2 [C3.6]: each Source gains an optional `remote` block carrying
 *     git provenance for catalogs cloned via `smith agent install --from
 *     <url>`. The on-disk writer emits `schemaVersion: 2`; the reader
 *     accepts v2, v1, and legacy `version: 1`, migrating in-memory.
 */
export interface Registry {
  schemaVersion: 2;
  sources: Source[];
}

const CURRENT_VERSION = 2;
const ACCEPTED_VERSIONS = new Set<number>([1, 2]);

export function defaultRegistry(): Registry {
  return {
    schemaVersion: CURRENT_VERSION,
    sources: [
      {
        kind: "user-global",
        rootPath: join(stateHome(), "agents"),
        label: "user-global",
      },
    ],
  };
}

const VALID_SOURCE_KINDS = new Set<Source["kind"]>([
  "user-global",
  "project",
  "registered",
]);

function validateRemote(raw: unknown, sourceIndex: number, reasons: string[]): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object") {
    reasons.push(`sources[${sourceIndex}].remote: must be an object`);
    return;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || r.url.length === 0) {
    reasons.push(`sources[${sourceIndex}].remote.url: must be a non-empty string`);
  }
  if (typeof r.ref !== "string" || r.ref.length === 0) {
    reasons.push(`sources[${sourceIndex}].remote.ref: must be a non-empty string`);
  }
  for (const optStr of ["lastPulledSha", "lastPulledAt", "lastRemoteSha", "lastCheckedAt"] as const) {
    if (r[optStr] !== undefined && typeof r[optStr] !== "string") {
      reasons.push(`sources[${sourceIndex}].remote.${optStr}: must be a string when present`);
    }
  }
  for (const shaField of ["lastPulledSha", "lastRemoteSha"] as const) {
    const v = r[shaField];
    if (typeof v === "string" && !/^[0-9a-f]{40}$/i.test(v)) {
      reasons.push(`sources[${sourceIndex}].remote.${shaField}: must be a 40-char hex SHA`);
    }
  }
}

function validateRegistry(data: unknown, path: string): Registry {
  const reasons: string[] = [];
  if (!data || typeof data !== "object") {
    throw new SmithError({
      code: "registry-corrupt-shape",
      path,
      reasons: ["root: expected an object"],
    });
  }
  const obj = data as Record<string, unknown>;
  // B11.1 + C3.6 migration: accept either `schemaVersion` (canonical) or
  // legacy `version` on read. `version` is a v1-only relic — accepting
  // `version: 2` would imply on-disk files we never wrote. Writer emits
  // `schemaVersion: 2` only.
  let rawVersion: unknown;
  if ("schemaVersion" in obj) {
    rawVersion = obj.schemaVersion;
  } else if ("version" in obj) {
    rawVersion = obj.version === 1 ? 1 : obj.version; // pass through for the reject branch below
    if (rawVersion !== 1) {
      throw new SmithError({
        code: "registry-version",
        current: typeof rawVersion === "number" ? rawVersion : -1,
        expected: CURRENT_VERSION,
        path,
      });
    }
  } else {
    rawVersion = undefined;
  }
  if (typeof rawVersion !== "number" || !ACCEPTED_VERSIONS.has(rawVersion)) {
    throw new SmithError({
      code: "registry-version",
      current: typeof rawVersion === "number" ? rawVersion : -1,
      expected: CURRENT_VERSION,
      path,
    });
  }
  if (!Array.isArray(obj.sources)) {
    throw new SmithError({
      code: "registry-corrupt-shape",
      path,
      reasons: ["sources: must be an array"],
    });
  }
  obj.sources.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      reasons.push(`sources[${i}]: must be an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.kind !== "string") {
      reasons.push(`sources[${i}].kind: must be a string`);
    } else if (!VALID_SOURCE_KINDS.has(s.kind as Source["kind"])) {
      reasons.push(
        `sources[${i}].kind: '${s.kind}' is not one of ${[...VALID_SOURCE_KINDS].join(", ")}`,
      );
    }
    if (typeof s.rootPath !== "string" || s.rootPath.length === 0) {
      reasons.push(`sources[${i}].rootPath: must be a non-empty string`);
    }
    if (typeof s.label !== "string" || s.label.length === 0) {
      reasons.push(`sources[${i}].label: must be a non-empty string`);
    }
    validateRemote(s.remote, i, reasons);
  });
  if (reasons.length > 0) {
    throw new SmithError({
      code: "registry-corrupt-shape",
      path,
      reasons,
    });
  }
  // Normalize: produce a Registry with `schemaVersion: 2` even when the
  // on-disk form used `version` or `schemaVersion: 1`. Drop the legacy
  // field from the in-memory shape so callers see one canonical form.
  return {
    schemaVersion: CURRENT_VERSION,
    sources: obj.sources as Source[],
  };
}

export async function loadRegistry(path: string): Promise<Registry> {
  const file = Bun.file(path);
  if (!(await file.exists())) return defaultRegistry();
  let data: unknown;
  try {
    data = await file.json();
  } catch (err) {
    throw new SmithError(
      {
        code: "registry-corrupt-json",
        path,
        parseError: toMessage(err),
      },
      { cause: err },
    );
  }
  return validateRegistry(data, path);
}

export async function saveRegistry(path: string, registry: Registry): Promise<void> {
  await atomicWriteJson(path, registry);
}

export type AddSourceResult =
  | { registry: Registry; status: "added" }
  | {
      registry: Registry;
      status: "noop-same-label" | "noop-different-label";
      existingLabel: string;
    };

/**
 * Add a source to the registry. Returns a discriminated-union result so
 * callers can distinguish "appended", "identical re-add" (no-op), and
 * "same path but caller's label was ignored" (no-op, but worth warning
 * about). The `"added"` variant carries no `existingLabel`; both
 * `"noop-*"` variants guarantee `existingLabel: string`.
 *
 * Throws `already-exists` when the label collides with an existing source
 * at a *different* rootPath — that's user error, not a silent no-op.
 *
 * On no-op branches (`noop-same-label`, `noop-different-label`), the returned
 * `registry` is the input reference unchanged (no clone) — callers can use
 * `result.registry === input` as a cheap "did anything change?" check.
 */
export function addSource(registry: Registry, source: Source): AddSourceResult {
  const existing = registry.sources.find(
    (s) => s.kind === source.kind && s.rootPath === source.rootPath,
  );
  if (existing) {
    return {
      registry,
      status:
        existing.label === source.label
          ? "noop-same-label"
          : "noop-different-label",
      existingLabel: existing.label,
    };
  }
  // Label uniqueness across all sources. We check AFTER the dedupe-by-path
  // short-circuit so re-adding the exact same source is still a no-op even
  // when the label happens to match itself. Distinct-rootPath, same-label
  // is a config bug — reject it instead of silently writing a registry
  // where two sources answer to the same name.
  const dupeLabel = registry.sources.some((s) => s.label === source.label);
  if (dupeLabel) {
    throw new SmithError({
      code: "already-exists",
      what: "agent catalog label",
      identifier: source.label,
      suggestedCommand: `smith agent register <path> --as <other-label>`,
    });
  }
  return {
    registry: { ...registry, sources: [...registry.sources, source] },
    status: "added",
  };
}

/**
 * Remove a source by `rootPath` OR `label` (whichever matches first).
 * Returns the registry unchanged if no match. Symmetric counterpart to
 * `addSource`'s label-uniqueness guard: if you can register by label,
 * you can unregister by label too.
 */
export function removeSource(registry: Registry, key: string): Registry {
  const match = registry.sources.find(
    (s) => s.label === key || s.rootPath === key,
  );
  if (!match) return registry;
  return {
    ...registry,
    sources: registry.sources.filter((s) => s !== match),
  };
}

/**
 * Rename an agent catalog (Source) by label. Throws if the label doesn't
 * exist or the new label is already taken by a different source. Renaming
 * a label to itself is a no-op (returns the same registry reference).
 */
export function renameSource(
  registry: Registry,
  oldLabel: string,
  newLabel: string,
): Registry {
  if (oldLabel === newLabel) return registry;
  const target = registry.sources.find((s) => s.label === oldLabel);
  if (!target) {
    throw new SmithError({
      code: "not-found",
      what: "agent catalog",
      identifier: oldLabel,
    });
  }
  const conflict = registry.sources.some(
    (s) => s !== target && s.label === newLabel,
  );
  if (conflict) {
    throw new SmithError({
      code: "already-exists",
      what: "agent catalog label",
      identifier: newLabel,
    });
  }
  return {
    ...registry,
    sources: registry.sources.map((s) =>
      s === target ? { ...s, label: newLabel } : s,
    ),
  };
}

/**
 * Stable label used by the synthetic self-source contributed by
 * resolveAllSources. Exported so tests and any future formatter that
 * wants to render the source distinctively can reference it without
 * string duplication.
 */
export const SELF_SOURCE_LABEL = "agent-smith-self";

/**
 * Optional dependency injection point for resolveAllSources. Tests
 * provide a synthetic resolveSelf to avoid touching the real filesystem.
 */
export interface ResolveAllSourcesDeps {
  resolveSelf?: () => Promise<Source | null>;
}

/**
 * Resolve a synthetic Source representing the running CLI's bundled
 * `agents/` directory, or null when:
 *   - the CLI isn't running from inside an agent-smith clone
 *     (resolveWorkspacePath returns null), or
 *   - the resolved repo doesn't have an `agents/` dir (defensive — should
 *     always exist in a real clone), or
 *   - any unexpected error.
 *
 * The kind is "registered" so consumers don't need to know about the
 * synthetic concept; the fixed label `agent-smith-self` (see
 * SELF_SOURCE_LABEL) identifies it. Never persisted.
 */
async function tryResolveSelfSource(): Promise<Source | null> {
  try {
    const cliPath = fileURLToPath(import.meta.url);
    const repoRoot = await resolveWorkspacePath(cliPath);
    if (!repoRoot) return null;
    const agentsDir = join(repoRoot, "agents");
    if (!(await pathExists(agentsDir))) return null;
    const gitRemote = await getOriginRemote(repoRoot);
    return {
      kind: "registered",
      rootPath: agentsDir,
      label: SELF_SOURCE_LABEL,
      ...(gitRemote ? { gitRemote } : {}),
    };
  } catch (err) {
    if (isDebug()) {
      console.error(
        `[smith debug] tryResolveSelfSource failed: ${(err as Error).message}`,
      );
    }
    return null;
  }
}

/**
 * Return the registry's persisted sources plus a synthetic self-source
 * pointing at the running CLI's bundled `agents/` dir. The synthetic
 * source is appended LAST so user-managed sources retain precedence.
 *
 * Dedup: if any registered source's `rootPath` resolves to the same
 * absolute path as the synthetic source's `rootPath`, the synthetic is
 * omitted to avoid loading the same bundle twice.
 *
 * Tests inject `deps.resolveSelf` to avoid touching the filesystem.
 */
export async function resolveAllSources(
  registry: Registry,
  deps: ResolveAllSourcesDeps = {},
): Promise<Source[]> {
  const resolver = deps.resolveSelf ?? tryResolveSelfSource;
  const self = await resolver();
  if (self === null) return registry.sources;
  const selfAbs = resolve(self.rootPath);
  const collision = registry.sources.some(
    (s) => resolve(s.rootPath) === selfAbs,
  );
  if (collision) return registry.sources;
  return [...registry.sources, self];
}

/**
 * Canonical absolute path to the per-user agent registry. Lazy resolver
 * so XDG_CONFIG_HOME can be honored at call time. See `stateHome()`.
 */
export function canonicalRegistryPath(): string {
  return join(stateHome(), "registry.json");
}

/**
 * Canonical absolute path to the per-user USER.md manifest. Lazy resolver
 * so XDG_CONFIG_HOME can be honored at call time. See `stateHome()`.
 */
export function canonicalUserPath(): string {
  return join(stateHome(), "USER.md");
}
