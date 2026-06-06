import { useCallback } from "react";
import { useNotifications } from "@/hooks/useNotifications";

const DISMISSED_KEY = "smith.installModal.dismissedSyncHints";

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

export interface SyncHintInput {
  catalogPath: string;
  gitRemote: string | undefined;
}

export function useSyncHintToast(onRegister: (gitRemote: string, catalogPath: string) => void) {
  const { notify } = useNotifications();

  const maybeFire = useCallback(
    (input: SyncHintInput) => {
      if (!input.gitRemote) return;
      const dismissed = readDismissed();
      if (dismissed.includes(input.catalogPath)) return;

      const remote = input.gitRemote;
      const path = input.catalogPath;
      const label = path.split("/").filter(Boolean).pop() ?? path;

      notify({
        kind: "info",
        title: `Installed from ${label}`,
        body: `Detected git remote ${remote}.\nRegister it to enable \`smith agent sync\`.`,
        durationMs: "sticky",
        dedupKey: `install-from-dir-sync-hint:${path}`,
        actions: [
          {
            label: "Register for sync",
            onClick: () => onRegister(remote, path),
            variant: "primary",
          },
        ],
      });
    },
    [notify, onRegister],
  );

  return { maybeFire };
}
