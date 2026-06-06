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
      // Local-directory inputs (absolute path or ./) are dispatched to the
      // discover-from-dir endpoint for agents. Skills keep using the URL
      // endpoint because skills/discover-from-dir does not exist yet.
      const isLocalDir =
        kind === "agent" &&
        /^[\/~]|^\.[\/]/.test(url) &&
        !url.endsWith(".smith-bundle.tgz") &&
        !url.endsWith(".tgz");
      const apiPath = isLocalDir
        ? "/api/agents/discover-from-dir"
        : `/api/${kind === "skill" ? "skills" : "agents"}/discover-from-url`;
      const body = isLocalDir
        ? JSON.stringify({ path: url })
        : JSON.stringify({ url, ref });
      const data = await apiFetch<DiscoverData>(apiPath, { method: "POST", body });
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
