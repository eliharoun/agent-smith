import { useState } from "react";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

const RECOMMENDATIONS = [
  {
    name: "agent-smith",
    description: "Tutor + bundle/skill architect for the smith ecosystem",
    recommended: true,
  },
  {
    name: "repo-cartographer",
    description: "Maps unfamiliar codebases on demand",
    recommended: false,
  },
  {
    name: "incident-debugger",
    description: "Walks through bugs systematically",
    recommended: false,
  },
] as const;

export function FirstAgent({ onNext }: { onNext: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const start = useStartJob();
  const statuses = useInstalledStatuses();

  const isInstalled = (name: string) => {
    const entry = statuses.data?.[name];
    if (!entry) return false;
    return Object.values(entry.installed ?? {}).some((v) => v === true);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="font-mono text-matrix-green text-2xl uppercase tracking-widest">
        // choose your first agent
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {RECOMMENDATIONS.map((r) => {
          const installed = isInstalled(r.name);
          return (
            <Card
              key={r.name}
              className={picked === r.name ? "border-matrix-green shadow-matrix-glow" : ""}
            >
              <button
                type="button"
                className="text-left w-full"
                onClick={() => setPicked(r.name)}
                disabled={installed}
                aria-label={installed ? `${r.name} (already installed)` : undefined}
              >
                <div className="font-mono text-matrix-green text-sm">
                  {r.name}
                  {r.recommended && " ★"}
                </div>
                <div className="text-matrix-body text-xs mt-2">{r.description}</div>
                {installed && (
                  <div className="mt-2 inline-block border border-matrix-green-muted px-2 py-[1px] font-mono text-[10px] text-matrix-green-muted">
                    installed
                  </div>
                )}
              </button>
            </Card>
          );
        })}
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onNext}>
          Skip
        </Button>
        <Button
          disabled={!picked || start.isPending || (picked !== null && isInstalled(picked))}
          onClick={async () => {
            await start.mutateAsync({
              command: "agent.install",
              name: picked!,
              platforms: ["opencode"],
              withSkills: false,
            });
            onNext();
          }}
        >
          Install
        </Button>
      </div>
    </div>
  );
}
