import { useEffect, useState } from "react";
import type { ExportManifest } from "gui-shared";
import { apiFetch } from "@/api/client";

interface PlanState {
  status: "idle" | "loading" | "ready" | "error";
  manifest?: ExportManifest;
  defaultExportDir?: string;
  error?: string;
}

export function useExportPlan(
  name: string | null,
  format: "archive" | "directory" = "archive",
) {
  const [state, setState] = useState<PlanState>({ status: "idle" });

  useEffect(() => {
    if (!name) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    apiFetch<{ manifest: ExportManifest; defaultExportDir: string }>(
      `/api/agents/${encodeURIComponent(name)}/export/plan?format=${format}`,
      { method: "POST" },
    )
      .then((body) => {
        if (cancelled) return;
        if (!body || typeof body !== "object" || !("manifest" in body) || !body.manifest) {
          setState({ status: "error", error: "server returned no manifest" });
          return;
        }
        setState({
          status: "ready",
          manifest: body.manifest,
          defaultExportDir: body.defaultExportDir,
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [name, format]);

  return state;
}
