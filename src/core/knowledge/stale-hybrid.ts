import type { RefreshMode, RetrievalMode } from "./types";

/** A source is "stale-hybrid" when it embeds content (hybrid, non-lazy) but
 *  never auto-refreshes (refresh mode install / unset). Its vectors are built
 *  once at install and then drift as the source changes upstream. This is a
 *  STATE predicate (not a transition) so it also flags an already-hybrid source
 *  whose refresh is later set back to install. Lazy sources are never indexed,
 *  so retrieval is inert and there is nothing to go stale. */
export function isStaleHybrid(args: {
  retrievalMode: RetrievalMode | undefined;
  refreshMode: RefreshMode | undefined;
  lazy: boolean;
}): boolean {
  if (args.lazy) return false;
  if (args.retrievalMode !== "hybrid") return false;
  // undefined refresh normalizes to "install" (refresh-spec.ts DEFAULT_REFRESH).
  return args.refreshMode === undefined || args.refreshMode === "install";
}
