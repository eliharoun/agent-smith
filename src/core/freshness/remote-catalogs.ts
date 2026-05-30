// src/core/freshness/remote-catalogs.ts
//
// C3.14 (v1-task): doctor `remote-catalogs` section. Reports drift
// between the local clone's `lastPulledSha` and the most recent value
// of `lastRemoteSha` recorded by `sync --check` (or by a fresh
// `installFromUrl`).
//
// We do NOT make any network calls here — the section is offline-safe.
// Live drift detection is the job of `sync --check`; doctor's role is
// to surface drift that the user (or a daemon) has already observed.
//
// Findings emitted:
//   - "catalog-behind-remote": lastPulledSha !== lastRemoteSha
//   - "catalog-stale-check":   lastCheckedAt > stalenessMs ago
//
// Both are informational warnings. Errors are reserved for I/O failures
// reading the registries (handled upstream by loadRegistry).

import type { Registry } from "../../io/registry";
import type { Source } from "../types";
import type { SkillCatalog, SkillRegistry } from "../../io/skill-registry";

export interface RemoteCatalogsReport {
  /** One entry per remote-backed catalog that has actionable findings. */
  findings: RemoteCatalogFinding[];
}

export interface RemoteCatalogFinding {
  kind: "agent" | "skill";
  label: string;
  rootPath: string;
  url: string;
  ref: string;
  /** Discriminator for renderers. */
  finding: "catalog-behind-remote" | "catalog-stale-check";
  /** Short human-readable detail. */
  detail: string;
}

export interface CheckRemoteCatalogsInput {
  registry: Registry;
  skillRegistry: SkillRegistry;
  /**
   * "now" — injected so tests can produce deterministic age calculations.
   * Defaults to `new Date()` in production callers.
   */
  now: Date;
  /**
   * Threshold (in ms) past `lastCheckedAt` that triggers a
   * `catalog-stale-check` finding. Defaults to 7 days. Tests override.
   */
  stalenessMs?: number;
}

const DEFAULT_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function checkRemoteCatalogs(input: CheckRemoteCatalogsInput): RemoteCatalogsReport {
  const stalenessMs = input.stalenessMs ?? DEFAULT_STALENESS_MS;
  const findings: RemoteCatalogFinding[] = [];

  for (const s of input.registry.sources) {
    appendFindings("agent", s, s.remote, input.now, stalenessMs, findings);
  }
  for (const c of input.skillRegistry.catalogs) {
    appendFindings("skill", c, c.remote, input.now, stalenessMs, findings);
  }

  return { findings };
}

function appendFindings(
  kind: "agent" | "skill",
  entry: Source | SkillCatalog,
  remote: Source["remote"],
  now: Date,
  stalenessMs: number,
  out: RemoteCatalogFinding[],
): void {
  if (!remote) return; // not a remote-backed catalog
  if (
    remote.lastPulledSha &&
    remote.lastRemoteSha &&
    remote.lastPulledSha !== remote.lastRemoteSha
  ) {
    out.push({
      kind,
      label: entry.label,
      rootPath: entry.rootPath,
      url: remote.url,
      ref: remote.ref,
      finding: "catalog-behind-remote",
      detail: `local ${remote.lastPulledSha.slice(0, 8)} → remote ${remote.lastRemoteSha.slice(0, 8)}`,
    });
  }
  if (remote.lastCheckedAt) {
    const ageMs = now.getTime() - new Date(remote.lastCheckedAt).getTime();
    if (ageMs > stalenessMs) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      out.push({
        kind,
        label: entry.label,
        rootPath: entry.rootPath,
        url: remote.url,
        ref: remote.ref,
        finding: "catalog-stale-check",
        detail: `last ls-remote ${days} day(s) ago`,
      });
    }
  }
}
