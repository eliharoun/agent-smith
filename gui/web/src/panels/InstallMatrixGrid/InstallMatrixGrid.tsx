import type { Platform } from "gui-shared";
import { useState } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { useStartJob } from "@/hooks/useStartJob";
import { RefreshConsent } from "@/panels/RefreshConsent";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { FieldHelp } from "@/ui/FieldHelp";
import { Toggle } from "@/ui/Toggle";

const PLATFORMS: Platform[] = ["opencode", "claude-code", "codex", "kiro"];

interface Pending {
  agent: string;
  installs: Platform[];
  uninstalls: Platform[];
}

// `desired[name][platform]` is set ONLY when the user has toggled that cell.
// Unset keys mean "no user intent — show the real installed state".
type Desired = Record<string, Partial<Record<Platform, boolean>>>;

export function InstallMatrixGrid() {
  const agents = useAgents();
  const statuses = useInstalledStatuses();
  const start = useStartJob();
  const [desired, setDesired] = useState<Desired>({});
  const [allowMissingCli, setAllowMissingCli] = useState(false);
  const [consent, setConsent] = useState<Pending | null>(null);

  function checkedFor(name: string, p: Platform): boolean {
    const userIntent = desired[name]?.[p];
    if (userIntent !== undefined) return userIntent;
    return statuses.data?.[name]?.installed[p] ?? false;
  }

  function toggle(name: string, p: Platform, v: boolean) {
    setDesired((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), [p]: v } }));
  }

  function computeQueue(): Pending | null {
    const installedMap = statuses.data ?? {};
    for (const a of agents.data ?? []) {
      const installed = installedMap[a.name]?.installed ?? {
        opencode: false,
        "claude-code": false,
        codex: false,
      };
      const installs: Platform[] = [];
      const uninstalls: Platform[] = [];
      for (const p of PLATFORMS) {
        const want = checkedFor(a.name, p);
        const have = installed[p];
        if (want && !have) installs.push(p);
        if (!want && have) uninstalls.push(p);
      }
      if (installs.length > 0 || uninstalls.length > 0) {
        return { agent: a.name, installs, uninstalls };
      }
    }
    return null;
  }

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // install matrix
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
            <th className="text-left py-1">agent</th>
            {PLATFORMS.map((p) => (
              <th key={p} className="py-1">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.data?.map((a) => (
            <tr key={a.name} className="border-t border-matrix-line">
              <td className="py-2 font-mono text-matrix-body">{a.name}</td>
              {PLATFORMS.map((p) => (
                <td key={p} className="py-2 text-center">
                  <Toggle
                    aria-label={`${a.name} · ${p}`}
                    checked={checkedFor(a.name, p)}
                    onChange={(v) => toggle(a.name, p, v)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center justify-end gap-4">
        <label className="flex items-center gap-2 text-xs text-matrix-body font-mono">
          <input
            type="checkbox"
            checked={allowMissingCli}
            onChange={(e) => setAllowMissingCli(e.target.checked)}
          />
          Render even if the target platform CLI isn't installed
          <FieldHelp fieldId="install.allowMissingCli" iconOnly>
            allow missing cli
          </FieldHelp>
        </label>
        <Button
          onClick={() => {
            const next = computeQueue();
            if (next) setConsent(next);
          }}
          disabled={start.isPending || statuses.isPending || agents.isPending}
        >
          Apply changes
        </Button>
      </div>
      {consent && (
        <RefreshConsent
          agent={consent.agent}
          platforms={consent.installs}
          onCancel={() => setConsent(null)}
          onConfirm={async (refreshConsent) => {
            try {
              if (consent.installs.length > 0) {
                await start.mutateAsync({
                  command: "agent.install",
                  name: consent.agent,
                  platforms: consent.installs,
                  withSkills: false,
                  ...(allowMissingCli ? { allowMissingCli: true } : {}),
                  refreshConsent,
                });
              }
              if (consent.uninstalls.length > 0) {
                await start.mutateAsync({
                  command: "agent.uninstall",
                  name: consent.agent,
                  platforms: consent.uninstalls,
                });
              }
              // Clear the user-intent for this agent ONLY on success — the
              // real installed status will refresh and reflect the new state.
              setDesired((prev) => {
                const { [consent.agent]: _drop, ...rest } = prev;
                return rest;
              });
            } finally {
              setConsent(null);
            }
          }}
        />
      )}
    </Card>
  );
}
