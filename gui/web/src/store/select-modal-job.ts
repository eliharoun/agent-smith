import type { JobExitInfo } from "./active-jobs";

/**
 * Choose which active job the modal should display.
 *
 * Rules:
 *  - If any job has exited, surface the **oldest** such job (FIFO completion
 *    surfacing). The user must dismiss it (Close) to see the next.
 *  - Else if there's at least one running job, surface the newest (active[0]).
 *  - Else return null.
 *
 * `active` is ordered most-recent-first (per useActiveJobsStore.push).
 */
export function selectModalJob(
  active: readonly string[],
  exits: Readonly<Record<string, JobExitInfo>>,
): string | undefined {
  if (active.length === 0) return undefined;
  // active is newest-first; reverse iteration finds oldest exited.
  for (let i = active.length - 1; i >= 0; i--) {
    const id = active[i];
    if (id !== undefined && exits[id] !== undefined) return id;
  }
  return active[0];
}
