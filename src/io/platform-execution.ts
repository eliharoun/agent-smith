import pc from "picocolors";
import type { PlatformId } from "./platform-detect";

/**
 * The result of resolving which platforms a command will act on. Three
 * disjoint sets:
 *
 *   - `execution`: platforms the command will write to. Always a subset
 *     of the manifest target list and the user's --platform flag (if any),
 *     intersected with what's actually detected on PATH (unless --platform
 *     was used to force). Order matches the manifestTargets order.
 *   - `skipped`: declared by the manifest but absent from PATH. The user
 *     should know about these — usually rendered as a single info line per
 *     command. Their state can later be replayed via a sync command.
 *   - `forced`: explicitly requested via --platform but not detected.
 *     These ARE in `execution` (the user asked for it), but rendered with
 *     an advisory note so they can't claim they were misled.
 */
export interface ExecutionPlan {
  execution: PlatformId[];
  skipped: PlatformId[];
  forced: PlatformId[];
}

export interface ResolveOpts {
  manifestTargets: PlatformId[];
  installed: Set<PlatformId>;
  /** From --platform <list>. When set, narrows execution to this list
   *  (still intersected with manifestTargets). Platforms in this list
   *  that aren't installed go into `forced`. */
  forceFilter?: PlatformId[];
}

/**
 * Pure function. No FS access. Caller does detection once and passes the
 * set in. Two guarantees:
 *
 *   - `execution = forced ∪ (manifestTargets ∩ installed ∩ (forceFilter ?? all))`
 *   - `execution ∩ skipped = ∅`
 */
export function resolveExecutionPlatforms(opts: ResolveOpts): ExecutionPlan {
  const candidates = opts.forceFilter
    ? opts.manifestTargets.filter((t) => opts.forceFilter?.includes(t))
    : opts.manifestTargets;
  const execution: PlatformId[] = [];
  const skipped: PlatformId[] = [];
  const forced: PlatformId[] = [];
  for (const platform of candidates) {
    if (opts.installed.has(platform)) {
      execution.push(platform);
    } else if (opts.forceFilter?.includes(platform)) {
      execution.push(platform);
      forced.push(platform);
    } else {
      skipped.push(platform);
    }
  }
  return { execution, skipped, forced };
}

/**
 * Format the skipped+forced summary for stderr. Returns the empty string
 * when there's nothing to report. Caller decides whether/how to print it.
 */
export function renderSkippedPlatforms(plan: ExecutionPlan): string {
  const lines: string[] = [];
  for (const p of plan.skipped) {
    lines.push(pc.dim(`~ ${p}: not detected — skipped (use --platform ${p} to force)`));
  }
  for (const p of plan.forced) {
    lines.push(pc.yellow(`! ${p}: forced — writing to undetected platform at user request`));
  }
  return lines.join("\n");
}
