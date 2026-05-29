import { useMutation } from "@tanstack/react-query";
import type { JobRequest } from "gui-shared";
import { jobsApi } from "@/api/jobs";
import { useActiveJobsStore } from "@/store/active-jobs";

export function useStartJob() {
  const push = useActiveJobsStore((s) => s.push);
  return useMutation({
    mutationFn: (req: JobRequest) => jobsApi.start(req),
    onSuccess: (started, variables) => {
      // Record the job + originating command. Invalidation of ['agents']
      // happens in <JobCompletionListener /> when the job's SSE stream
      // emits an `exit` event — invalidating here, at job-start, was a
      // bug: it refetched the agents list before destroy/install/uninstall
      // had actually run.
      push(started.jobId, variables.command);
    },
  });
}
