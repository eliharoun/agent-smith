import { useCallback, useState } from "react";
import { apiFetch } from "@/api/client";

export interface DiscoveredBundle {
  name: string;
  description: string;
  targets?: string[];
  alreadyInstalled: boolean;
}

export interface DiscoverData {
  kind: "skill" | "agent";
  bundles: DiscoveredBundle[];
  detectedTargets: string[];
  catalog: { suggestedLabel: string; rootPath: string };
  existingCatalog: null | { label: string; kind: string };
}

export function useDiscoverFromUrl(kind: "skill" | "agent") {
  const [status, setStatus] = useState<"idle" | "discovering" | "select" | "error">("idle");
  const [data, setData] = useState<DiscoverData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async (url: string, ref?: string) => {
    // file:// is rejected server-side (a browser GUI must not make the server
    // clone arbitrary local paths); pre-check here to fail fast without a round-trip.
    if (url.startsWith("file://")) {
      setError("file:// URLs aren't allowed from the GUI");
      setStatus("error");
      return;
    }
    setStatus("discovering");
    setError(null);
    try {
      const path = `/api/${kind === "skill" ? "skills" : "agents"}/discover-from-url`;
      const data = await apiFetch<DiscoverData>(path, { method: "POST", body: JSON.stringify({ url, ref }) });
      setData(data);
      setStatus("select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "discovery failed");
      setStatus("error");
    }
  }, [kind]);

  const reset = useCallback(() => {
    setStatus("idle");
    setData(null);
    setError(null);
  }, []);

  return { status, data, error, discover, reset };
}
