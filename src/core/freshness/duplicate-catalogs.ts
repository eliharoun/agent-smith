// src/core/freshness/duplicate-catalogs.ts
//
// [v1-task RC2-10] Doctor section: detects registry entries that point at
// the same upstream git repository (modulo URL normalization — scheme,
// case, trailing .git).
//
// Why this matters:
//   - rc.1's install --from never refused duplicates, so users running
//     the same command twice (or different URL spellings for the same
//     repo) could accumulate stale clusters of catalogs all tracking the
//     same upstream. RC2-4 closes the forward door (install hard-errors);
//     this check surfaces the existing back-catalog so users can clean up.
//   - register --git-remote still allows duplicates (RC2-5 warns at
//     creation time but doesn't refuse — sometimes you legitimately want
//     two labels for the same remote). Doctor centralizes the audit.
//
// Scope:
//   - Inspects BOTH registries (agent + skill) together. A cluster may
//     span across registries (an agent catalog and a skill catalog
//     pointing at the same repo cluster together).
//   - Only entries with a `gitRemote` are considered. Linked catalogs
//     without a remote are by definition unique on disk and not
//     candidates for deduplication.
//   - Severity is "warn" — informational only, never bumps exit code.
//     The user may legitimately want both copies (e.g. one as
//     install-managed clone, one as a linked local checkout for editing).
//
// Output shape:
//   - `clusters` is the list of >=2-sized groups, each carrying the
//     normalized URL and the member entries (with registry kind + label
//     + rootPath for actionable remediation hints).
//   - `findings.length === 0` ⇒ section reports "ok".

import { normalizeGitUrl } from "../../io/git-url";
import type { Registry } from "../../io/registry";
import type { SkillRegistry } from "../../io/skill-registry";

export interface DuplicateCatalogMember {
  registryKind: "agent" | "skill";
  label: string;
  rootPath: string;
  /** The raw (un-normalized) URL as recorded in the registry. */
  url: string;
}

export interface DuplicateCatalogCluster {
  /** Result of normalizeGitUrl applied to every member's URL. */
  normalizedUrl: string;
  members: DuplicateCatalogMember[];
}

export interface DuplicateCatalogsReport {
  clusters: DuplicateCatalogCluster[];
}

export interface CheckDuplicateCatalogsInput {
  registry: Registry;
  skillRegistry: SkillRegistry;
}

/**
 * Pure: groups registry entries by normalized git URL and returns
 * clusters of size >= 2. Members are emitted in a stable order:
 * agent registry first, then skill, preserving the order each
 * registry returned them in. The clusters themselves are sorted by
 * normalizedUrl for deterministic output.
 */
export function checkDuplicateCatalogs(
  input: CheckDuplicateCatalogsInput,
): DuplicateCatalogsReport {
  const buckets = new Map<string, DuplicateCatalogMember[]>();

  for (const s of input.registry.sources) {
    if (!s.gitRemote) continue;
    const key = safeNormalize(s.gitRemote);
    if (key === null) continue;
    addMember(buckets, key, {
      registryKind: "agent",
      label: s.label,
      rootPath: s.rootPath,
      url: s.gitRemote,
    });
  }

  for (const c of input.skillRegistry.catalogs) {
    if (!c.gitRemote) continue;
    const key = safeNormalize(c.gitRemote);
    if (key === null) continue;
    addMember(buckets, key, {
      registryKind: "skill",
      label: c.label,
      rootPath: c.rootPath,
      url: c.gitRemote,
    });
  }

  const clusters: DuplicateCatalogCluster[] = [];
  for (const [normalizedUrl, members] of buckets) {
    if (members.length >= 2) {
      clusters.push({ normalizedUrl, members });
    }
  }
  clusters.sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));
  return { clusters };
}

/**
 * normalizeGitUrl throws on malformed URLs (e.g. missing host). Doctor
 * is a read-only audit — a malformed URL shouldn't bubble up and abort
 * the whole run, just exclude that entry from clustering. Callers can
 * still see the bad entry via the registry-hygiene section.
 */
function safeNormalize(url: string): string | null {
  try {
    return normalizeGitUrl(url);
  } catch {
    return null;
  }
}

function addMember(
  buckets: Map<string, DuplicateCatalogMember[]>,
  key: string,
  member: DuplicateCatalogMember,
): void {
  const existing = buckets.get(key);
  if (existing) {
    existing.push(member);
  } else {
    buckets.set(key, [member]);
  }
}
