import { useCallback, useState } from "react";

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
    setStatus("discovering");
    setError(null);
    try {
      const res = await fetch(
        `/api/${kind === "skill" ? "skills" : "agents"}/discover-from-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, ref }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? "discovery failed");
        setStatus("error");
        return;
      }
      setData(json as DiscoverData);
      setStatus("select");
    } catch (e) {
      setError((e as Error).message);
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
