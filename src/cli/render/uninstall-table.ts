import pc from "picocolors";
import type { UninstallPlan } from "../../io/uninstaller";

export interface RenderUninstallTableOptions {
  /** Print a `"<bundleName>":` header before each bundle's table. */
  perBundleHeader?: boolean;
  /** Verb for rows whose target exists (default: "→ remove"). */
  verbForExisting?: string;
  /** Verb for rows whose target is absent (default: "skip"). */
  verbForMissing?: string;
}

interface Row {
  marker: string;
  target: string;
  status: string;
  verb: string;
}

/**
 * Render an UninstallPlan (or array of them) as an aligned per-target table
 * including a knowledge row. Pure: returns string lines, no I/O.
 *
 * Used by: smith agent uninstall, smith agent uninstall-all, smith agent destroy.
 * Verb column is parameterized so destroy-agent can use destroy-specific
 * wording without forking the layout.
 */
export function renderUninstallTable(
  plans: UninstallPlan[],
  opts: RenderUninstallTableOptions = {},
): string[] {
  const verbExisting = opts.verbForExisting ?? "→ remove";
  const verbMissing = opts.verbForMissing ?? "skip";

  const out: string[] = [];
  for (const plan of plans) {
    const rows: Row[] = [];
    for (const t of plan.targets) {
      rows.push({
        marker: t.exists ? pc.green("●") : pc.dim("✗"),
        target: t.target,
        status: t.exists ? "installed" : "not installed",
        verb: t.exists ? verbExisting : verbMissing,
      });
    }
    const k = plan.knowledge;
    const knStatus =
      k.exists === true ? "installed" : k.exists === false ? "not installed" : "unknown";
    const knMarker =
      k.exists === true ? pc.green("●") : k.exists === false ? pc.dim("✗") : pc.yellow("?");
    const knVerb = k.exists === true ? verbExisting : verbMissing;
    rows.push({ marker: knMarker, target: "knowledge", status: knStatus, verb: knVerb });

    const targetCol = Math.max(...rows.map((r) => r.target.length));
    const statusCol = Math.max(...rows.map((r) => r.status.length));

    if (opts.perBundleHeader) {
      if (out.length > 0) out.push("");
      out.push(pc.bold(`"${plan.bundleName}":`));
    }
    for (const r of rows) {
      const targetPad = " ".repeat(targetCol - r.target.length);
      const statusPad = " ".repeat(statusCol - r.status.length);
      out.push(`  ${r.marker} ${r.target}${targetPad}  ${r.status}${statusPad}  ${r.verb}`);
    }
  }
  return out;
}
