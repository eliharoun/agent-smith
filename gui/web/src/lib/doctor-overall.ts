import type { DoctorRefusal, DoctorResponse } from "gui-shared";

export type OverallHealth = "healthy" | "degraded" | "unhealthy";
export type CheckStatus = "ok" | "warn" | "error";

export interface FlatCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

// Use absence of `platforms` (the canonical DoctorReport field) as the
// discriminator instead of presence of `error`. This stays correct if a
// future DoctorReport ever grows an `error` field for non-refusal errors.
export function isRefusal(r: DoctorResponse): r is DoctorRefusal {
  return !("platforms" in r);
}

/**
 * Derive overall GUI health.
 * - exitCode 2 OR any 'error' section → unhealthy
 * - exitCode 1 OR any 'warn' section → degraded
 * - otherwise → healthy
 *
 * For the refusal payload, always 'unhealthy'.
 */
export function deriveOverallHealth(r: DoctorResponse): OverallHealth {
  if (isRefusal(r)) return "unhealthy";
  if (r.exitCode === 2) return "unhealthy";
  // Inspect optional sections for elevated severity beyond the CLI's
  // exitCode rollup. Only sections we schematize matter; opaque
  // (z.unknown()) sections we treat as informational.
  const checks = flattenChecks(r);
  if (checks.some((c) => c.status === "error")) return "unhealthy";
  if (r.exitCode === 1) return "degraded";
  if (checks.some((c) => c.status === "warn")) return "degraded";
  return "healthy";
}

function platformLabel(p: "opencode" | "claude-code" | "codex" | "kiro"): string {
  if (p === "opencode") return "OpenCode schema";
  if (p === "claude-code") return "Claude Code (manual)";
  if (p === "kiro") return "Kiro (manual)";
  return "Codex (manual)";
}

export function flattenChecks(r: DoctorResponse): FlatCheck[] {
  if (isRefusal(r)) {
    return [
      {
        id: "refusal",
        label: "AI platform detection",
        status: "error",
        detail: r.message,
      },
    ];
  }
  const out: FlatCheck[] = [];
  for (const p of r.platforms) {
    if (p.platform === "opencode") {
      let status: CheckStatus = "ok";
      let detail: string | undefined;
      if (p.status === "drift") {
        status = "warn";
        detail = p.drift.headline;
      } else if (p.status === "network-error") {
        status = "error";
        detail = p.networkError;
      } else if (p.status === "offline-skipped") {
        status = "ok";
        detail = "offline mode";
      }
      out.push({
        id: "platform:opencode",
        label: platformLabel("opencode"),
        status,
        ...(detail !== undefined ? { detail } : {}),
      });
    } else {
      // manual platforms always 'ok'
      out.push({
        id: `platform:${p.platform}`,
        label: platformLabel(p.platform),
        status: "ok",
        detail: `verified ${p.lastVerifiedDate} against ${p.verifiedAgainstVersion}`,
      });
    }
  }
  for (const sp of r.skippedPlatforms) {
    out.push({
      id: `skipped:${sp}`,
      label: platformLabel(sp),
      status: "ok",
      detail: "not on PATH",
    });
  }
  // Atlassian auth section
  out.push({
    id: "atlassianAuth",
    label: "Atlassian credentials",
    status:
      r.atlassianAuth.status === "configured" || r.atlassianAuth.status === "not-applicable"
        ? "ok"
        : "warn",
    detail:
      r.atlassianAuth.status === "configured"
        ? `source: ${r.atlassianAuth.source}`
        : r.atlassianAuth.status === "not-applicable"
          ? "not needed"
          : "not configured",
  });
  // mcp-deps section. One FlatCheck per finding so the radial shows
  // each missing dependency individually rather than a single rolled-up
  // status (matches the per-platform / per-source pattern above).
  if (r.mcpDeps?.findings) {
    for (const f of r.mcpDeps.findings) {
      out.push({
        id: `mcp-deps:${f.agent}:${f.server}`,
        label: `MCP ${f.kind}: ${f.agent} → ${f.server}`,
        status: f.severity === "error" ? "error" : "warn",
        detail:
          f.kind === "required"
            ? `bundle requires '${f.server}' but it's not configured in any platform MCP config`
            : `bundle expects '${f.server}' (peer; not strictly required)`,
      });
    }
  }
  // (Other z.unknown() sections that may land in the future are still not
  // flattened — they remain available on the report for future expansion
  // without forcing a schema bump.)
  return out;
}
