import pc from "picocolors";
import { listPendingOps } from "../io/pending-ops";
import type { PlatformId } from "../io/platform-detect";

export interface PendingHintOpts {
  stateHome: string;
  installedPlatforms: Set<PlatformId>;
}

/**
 * Build a one-line hint listing platforms that are now detected AND
 * have pending ops. Returns the empty string when nothing matches.
 *
 * Pure function — does not check env vars itself. The startup gate
 * (currently `SMITH_HINT_PENDING=1`) lives at the call site so this
 * helper stays trivially testable.
 */
export async function renderPendingHint(opts: PendingHintOpts): Promise<string> {
  const ops = await listPendingOps(opts.stateHome);
  const matchingPlatforms = new Set<PlatformId>();
  for (const op of ops) {
    if (opts.installedPlatforms.has(op.platform)) {
      matchingPlatforms.add(op.platform);
    }
  }
  if (matchingPlatforms.size === 0) return "";
  const platforms = [...matchingPlatforms].sort();
  return pc.dim(
    `[hint] ${platforms.join(", ")} now detected with pending operations. ` +
      `A future release will let you replay them.`,
  );
}
