import { useCallback, useEffect, useState } from "react";

const MAX_RECENTS = 5;

function storageKey(format: "archive" | "directory"): string {
  return `smith.exportModal.recents.${format}`;
}

function readStorage(format: "archive" | "directory"): string[] {
  try {
    const raw = localStorage.getItem(storageKey(format));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

export function useExportRecents(format: "archive" | "directory") {
  const [recents, setRecents] = useState<string[]>(() => readStorage(format));

  // Re-sync when the format prop flips — caller may toggle archive↔directory
  // without remounting the hook.
  useEffect(() => {
    setRecents(readStorage(format));
  }, [format]);

  const add = useCallback(
    (path: string) => {
      if (path.trim().length === 0) return;
      setRecents((prev) => {
        const next = [path, ...prev.filter((p) => p !== path)].slice(0, MAX_RECENTS);
        try {
          localStorage.setItem(storageKey(format), JSON.stringify(next));
        } catch {
          // localStorage write can fail in private mode / over quota.
        }
        return next;
      });
    },
    [format],
  );

  return { recents, add };
}
