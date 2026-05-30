import { join } from "node:path";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import type { Remote } from "../core/types";
import { atomicWriteJson } from "./atomic-write";
import { defaultRemoteRoot } from "./remote-root";
import { stateHome } from "./state-home";

const ATLASSIAN_SKILLS_GIT_URL = "https://github.com/langpingxue/atlassian-skills.git";
const ATLASSIAN_SKILLS_LABEL = "atlassian-skills";

export type SkillCatalogKind = "user-global" | "user-local" | "team-shared";

/**
 * One entry in the SKILL registry. Represents a directory containing
 * one or more skill bundles (per-bundle subdir with `SKILL.md`).
 *
 * User-facing terminology: "skill catalog" — the internal type name
 * already matches.
 *
 * Parallel structure: `Source` (in src/core/types.ts) is the
 * equivalent for the AGENT registry. The two registries are kept
 * separate because their content schemas differ (agent.config.json vs
 * SKILL.md), their consumers differ (smith agent install/daemon vs smith
 * skill install/list), and their lifecycles differ (agents are
 * rendered+installed; skills are referenced in place).
 */
export interface SkillCatalog {
  kind: SkillCatalogKind;
  /** Absolute path to the directory containing per-skill subdirectories. */
  rootPath: string;
  /** Human-readable label shown in `smith skill catalogs`. Unique within registry. */
  label: string;
  /** Optional git remote URL the catalog was cloned from. */
  gitRemote?: string;
  /**
   * True for catalogs auto-created by `smith skill install <url>` (D2).
   * Hidden from `smith skill list` by default; visible with `--all`.
   * D1 ships the field; no code creates adhoc catalogs yet.
   */
  adhoc?: boolean;
  /**
   * True for catalogs that smith depends on. `unregister` rejects removal.
   */
  protected?: boolean;
  /**
   * Git provenance for catalogs cloned via `smith skill install --from
   * <url>` (C-series, v0.25.0). Undefined for local-only catalogs.
   */
  remote?: Remote;
}

/**
 * The SKILL registry document. Persisted at
 * `~/.config/agent-smith/skill-catalogs.json`. See `SkillCatalog`
 * above for the conceptual model and the parallel agent registry.
 *
 * Schema-version history:
 *   - v1 [B11.2]: `schemaVersion: 1` renamed from `version: 1`.
 *   - v2 [C3.7]: each SkillCatalog gains an optional `remote` block
 *     carrying git provenance for catalogs cloned via `smith skill
 *     install --from <url>`. Loader accepts v1 (with `schemaVersion: 1`
 *     OR legacy `version: 1`) and v2; writer emits v2 only. `version: N`
 *     legacy field name is v1-only.
 */
export interface SkillRegistry {
  schemaVersion: 2;
  catalogs: SkillCatalog[];
}

const CURRENT_VERSION = 2;
const ACCEPTED_VERSIONS = new Set<number>([1, 2]);

export function bootstrapAtlassianSkillsCatalog(): SkillCatalog {
  const remoteRoot = defaultRemoteRoot();
  const cloneDir = join(remoteRoot, "github.com", "langpingxue", "atlassian-skills");
  return {
    kind: "team-shared",
    label: ATLASSIAN_SKILLS_LABEL,
    rootPath: cloneDir,
    gitRemote: ATLASSIAN_SKILLS_GIT_URL,
    remote: { url: ATLASSIAN_SKILLS_GIT_URL, ref: "HEAD" },
    protected: true,
  };
}

export function defaultSkillRegistry(): SkillRegistry {
  return {
    schemaVersion: CURRENT_VERSION,
    catalogs: [bootstrapAtlassianSkillsCatalog()],
  };
}

function validateRemote(raw: unknown, catalogIndex: number, reasons: string[]): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object") {
    reasons.push(`catalogs[${catalogIndex}].remote: must be an object`);
    return;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || r.url.length === 0) {
    reasons.push(`catalogs[${catalogIndex}].remote.url: must be a non-empty string`);
  }
  if (typeof r.ref !== "string" || r.ref.length === 0) {
    reasons.push(`catalogs[${catalogIndex}].remote.ref: must be a non-empty string`);
  }
  for (const optStr of [
    "lastPulledSha",
    "lastPulledAt",
    "lastRemoteSha",
    "lastCheckedAt",
  ] as const) {
    if (r[optStr] !== undefined && typeof r[optStr] !== "string") {
      reasons.push(`catalogs[${catalogIndex}].remote.${optStr}: must be a string when present`);
    }
  }
  for (const shaField of ["lastPulledSha", "lastRemoteSha"] as const) {
    const v = r[shaField];
    if (typeof v === "string" && !/^[0-9a-f]{40}$/i.test(v)) {
      reasons.push(`catalogs[${catalogIndex}].remote.${shaField}: must be a 40-char hex SHA`);
    }
  }
}

function validateSkillRegistry(data: unknown, path: string): SkillRegistry {
  if (!data || typeof data !== "object") {
    throw new SmithError({
      code: "skill-registry-corrupt-shape",
      path,
      reasons: ["root: expected an object"],
    });
  }
  const obj = data as Record<string, unknown>;
  // B11.2 + C3.7 migration: accept either `schemaVersion` (canonical) or
  // legacy `version` on read. `version` is a v1-only relic — accepting
  // `version: 2` would imply on-disk files we never wrote. Writer emits
  // `schemaVersion: 2` only. v1 inputs normalize to v2 in memory.
  let rawVersion: unknown;
  if ("schemaVersion" in obj) {
    rawVersion = obj.schemaVersion;
  } else if ("version" in obj) {
    rawVersion = obj.version === 1 ? 1 : obj.version;
    if (rawVersion !== 1) {
      throw new SmithError({
        code: "skill-registry-version",
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
      code: "skill-registry-version",
      current: typeof rawVersion === "number" ? rawVersion : -1,
      expected: CURRENT_VERSION,
      path,
    });
  }
  if (!Array.isArray(obj.catalogs)) {
    throw new SmithError({
      code: "skill-registry-corrupt-shape",
      path,
      reasons: ["catalogs: must be an array"],
    });
  }
  const reasons: string[] = [];
  obj.catalogs.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      reasons.push(`catalogs[${i}]: must be an object`);
      return;
    }
    const c = raw as Record<string, unknown>;
    for (const field of ["kind", "rootPath", "label"] as const) {
      if (typeof c[field] !== "string") {
        reasons.push(`catalogs[${i}].${field}: must be a string (got ${typeof c[field]})`);
      }
    }
    if (c.protected !== undefined && typeof c.protected !== "boolean") {
      reasons.push(
        `catalogs[${i}].protected: must be a boolean if present (got ${typeof c.protected})`,
      );
    }
    if (c.adhoc !== undefined && typeof c.adhoc !== "boolean") {
      reasons.push(`catalogs[${i}].adhoc: must be a boolean if present (got ${typeof c.adhoc})`);
    }
    if (c.gitRemote !== undefined && typeof c.gitRemote !== "string") {
      reasons.push(
        `catalogs[${i}].gitRemote: must be a string if present (got ${typeof c.gitRemote})`,
      );
    }
    validateRemote(c.remote, i, reasons);
  });
  if (reasons.length > 0) {
    throw new SmithError({
      code: "skill-registry-corrupt-shape",
      path,
      reasons,
    });
  }
  // Normalize: produce a SkillRegistry with `schemaVersion: 2` even when
  // the on-disk form used `version` or `schemaVersion: 1`. Drop legacy
  // field from in-memory shape.
  return {
    schemaVersion: CURRENT_VERSION,
    catalogs: obj.catalogs as SkillCatalog[],
  };
}

export async function loadSkillRegistry(path: string): Promise<SkillRegistry> {
  const file = Bun.file(path);
  if (!(await file.exists())) return defaultSkillRegistry();
  let data: unknown;
  try {
    data = await file.json();
  } catch (err) {
    // Bun.file.json() surfaces native JSON.parse errors which can be terse and
    // path-less. Re-throw as a typed SmithError so the wrapper renders a
    // diagnosable message with the file path.
    throw new SmithError({
      code: "skill-registry-corrupt-json",
      path,
      parseError: toMessage(err),
    });
  }
  const reg = validateSkillRegistry(data, path);
  // Defensive: if the on-disk file lacks any protected catalog from the
  // defaults (e.g. a user hand-edited `catalogs: []`), splice them back
  // in-memory. We do NOT eagerly re-save here — the next genuine mutation
  // will persist via saveSkillRegistry. This keeps loadSkillRegistry
  // side-effect-free on disk.
  const missing = defaultSkillRegistry().catalogs.filter(
    (d) => d.protected && !reg.catalogs.some((c) => c.label === d.label),
  );
  if (missing.length > 0) {
    return { ...reg, catalogs: [...missing, ...reg.catalogs] };
  }
  return reg;
}

export async function saveSkillRegistry(path: string, registry: SkillRegistry): Promise<void> {
  // Atomic write via shared helper. See `src/io/atomic-write.ts` for the
  // POSIX rename guarantees and the (deliberately unhandled) concurrent-
  // writer caveat.
  await atomicWriteJson(path, registry);
}

export type AddCatalogResult =
  | { registry: SkillRegistry; status: "added" }
  | {
      registry: SkillRegistry;
      status: "noop-same-label" | "noop-different-label";
      existingLabel: string;
    };

/**
 * Add a catalog to the registry. Returns a discriminated-union result so
 * callers can distinguish "appended", "identical re-add" (no-op), and
 * "same path but caller's label was ignored" (no-op, but worth warning
 * about). The `"added"` variant carries no `existingLabel`; both
 * `"noop-*"` variants guarantee `existingLabel: string`.
 *
 * Throws `already-exists` when the label collides with an existing catalog
 * at a *different* rootPath — that's user error, not a silent no-op.
 *
 * On no-op branches (`noop-same-label`, `noop-different-label`), the returned
 * `registry` is the input reference unchanged (no clone) — callers can use
 * `result.registry === input` as a cheap "did anything change?" check.
 */
export function addCatalog(registry: SkillRegistry, catalog: SkillCatalog): AddCatalogResult {
  const existing = registry.catalogs.find(
    (c) => c.kind === catalog.kind && c.rootPath === catalog.rootPath,
  );
  if (existing) {
    return {
      registry,
      status: existing.label === catalog.label ? "noop-same-label" : "noop-different-label",
      existingLabel: existing.label,
    };
  }
  const dupeLabel = registry.catalogs.some((c) => c.label === catalog.label);
  if (dupeLabel) {
    throw new SmithError({
      code: "already-exists",
      what: "skill catalog label",
      identifier: catalog.label,
      suggestedCommand: `smith skill register <path> --label <other-label>`,
    });
  }
  return {
    registry: { ...registry, catalogs: [...registry.catalogs, catalog] },
    status: "added",
  };
}

/**
 * Remove a catalog by label OR rootPath (whichever matches). Returns the
 * registry unchanged if no match. Throws if the matched catalog is protected.
 */
export function removeCatalog(registry: SkillRegistry, key: string): SkillRegistry {
  const match = registry.catalogs.find((c) => c.label === key || c.rootPath === key);
  if (!match) return registry;
  if (match.protected) {
    throw new SmithError({
      code: "protected-catalog",
      name: match.label,
    });
  }
  return {
    ...registry,
    catalogs: registry.catalogs.filter((c) => c !== match),
  };
}

/**
 * Canonical absolute path to the per-user skill catalogs registry. Lazy
 * resolver so XDG_CONFIG_HOME can be honored at call time. See `stateHome()`.
 */
export function canonicalSkillRegistryPath(): string {
  return join(stateHome(), "skill-catalogs.json");
}

/**
 * Rename a catalog by label. Throws if the label doesn't exist, the new
 * label is already in use by a different catalog, or the matched catalog
 * is protected. Renaming a label to itself is a no-op (returns the same
 * registry reference).
 */
export function renameCatalog(
  registry: SkillRegistry,
  oldLabel: string,
  newLabel: string,
): SkillRegistry {
  if (oldLabel === newLabel) return registry;
  const target = registry.catalogs.find((c) => c.label === oldLabel);
  if (!target) {
    throw new SmithError({
      code: "not-found",
      what: "skill catalog",
      identifier: oldLabel,
    });
  }
  if (target.protected) {
    throw new SmithError({
      code: "protected-catalog",
      name: target.label,
    });
  }
  const conflict = registry.catalogs.some((c) => c !== target && c.label === newLabel);
  if (conflict) {
    throw new SmithError({
      code: "already-exists",
      what: "skill catalog label",
      identifier: newLabel,
    });
  }
  return {
    ...registry,
    catalogs: registry.catalogs.map((c) => (c === target ? { ...c, label: newLabel } : c)),
  };
}
