import { useJobStream } from "@/hooks/useJobStream";
import { useActiveJobsStore } from "@/store/active-jobs";

export function useTerminalStripData() {
  const last = useActiveJobsStore((s) => s.active[0]);
  const events = useJobStream(last);
  const lines = events
    .map((e) =>
      e.type === "stdout"
        ? { kind: "stdout" as const, text: e.chunk }
        : e.type === "stderr"
          ? { kind: "stderr" as const, text: e.chunk }
          : e.type === "exit"
            ? { kind: "system" as const, text: `[exit ${e.code} in ${e.durationMs}ms]` }
            : null,
    )
    .filter((x): x is { kind: "stdout" | "stderr" | "system"; text: string } => x !== null);
  return { jobId: last, lines };
}
