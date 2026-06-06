import { useCallback, useEffect, useRef } from "react";
import { useActiveJobsStore } from "@/store/active-jobs";
import { useJobStream } from "@/hooks/useJobStream";
import { useSyncHintToast } from "@/hooks/useSyncHintToast";
import { useStartJob } from "@/hooks/useStartJob";

interface DirInstallEnvelope {
  catalogRootPath: string;
  detectedGitRemote: string | null;
  bundles: string[];
}

function parseDirEnvelope(stdout: string): DirInstallEnvelope | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "catalogRootPath" in parsed &&
        "bundles" in parsed
      ) {
        return parsed as DirInstallEnvelope;
      }
    } catch {
      // not valid JSON — keep scanning
    }
  }
  return null;
}

/**
 * Watches a single agent.install job's SSE stream. When it exits with code 0
 * and stdout contained a dir-install envelope, fires the sync-hint toast so
 * the user can register the catalog for `smith agent sync`.
 *
 * Rendered once per active agent.install job by useInstallCompletionWatcher.
 * Mirrors the JobWatcher + JobCompletionListener split pattern.
 */
export function InstallJobWatcher({
  jobId,
  maybeFire,
}: {
  jobId: string;
  maybeFire: ReturnType<typeof useSyncHintToast>["maybeFire"];
}) {
  const events = useJobStream(jobId);
  const firedRef = useRef(false);
  const exitEvent = events.find((e) => e.type === "exit");

  useEffect(() => {
    if (!exitEvent || exitEvent.type !== "exit") return;
    if (firedRef.current) return;
    if (exitEvent.code !== 0) return;
    firedRef.current = true;

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => (e.type === "stdout" ? e.chunk : ""))
      .join("");

    const envelope = parseDirEnvelope(stdout);
    if (!envelope || !envelope.detectedGitRemote) return;

    maybeFire({
      catalogPath: envelope.catalogRootPath,
      gitRemote: envelope.detectedGitRemote,
    });
  }, [exitEvent, events, maybeFire]);

  return null;
}

/**
 * Returns the set of active agent.install job IDs and a stable maybeFire
 * callback bound to a register-for-sync handler. Callers render one
 * <InstallJobWatcher> per returned jobId.
 *
 * The register callback dispatches agent.register with skipGitCheck: true so
 * the GUI doesn't re-probe a remote the CLI already validated on install.
 */
export function useInstallCompletionWatcher() {
  const active = useActiveJobsStore((s) => s.active);
  const commands = useActiveJobsStore((s) => s.commands);
  const start = useStartJob();

  // Stable callback identity so useSyncHintToast's useCallback doesn't
  // rebuild maybeFire on every render.
  const handleRegisterForSync = useCallback(
    (gitRemote: string, catalogPath: string) => {
      start.mutate({
        command: "agent.register",
        path: catalogPath,
        kind: "registered",
        gitRemote,
        skipGitCheck: true,
        allowEmpty: false,
      });
    },
    [start],
  );

  const { maybeFire } = useSyncHintToast(handleRegisterForSync);

  const installJobIds = active.filter((id) => commands[id] === "agent.install");

  return { installJobIds, maybeFire };
}
