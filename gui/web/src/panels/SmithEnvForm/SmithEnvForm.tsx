import type { SmithEnv } from "gui-shared";
import { useEffect, useState } from "react";
import { usePutSmithEnv, useSmithEnv } from "@/hooks/useSmithEnv";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { FormField } from "@/ui/FormField";

const DEFAULT_PULL_MS = 30000;
const DEFAULT_HEARTBEAT_MS = 2000;

/** "" | "<int>" → undefined / NaN / number */
function parsePositiveInt(s: string): number | undefined | typeof NaN {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

/**
 * /system/daemon — env-tuning form. Persists positive-integer values
 * into ~/.config/agent-smith/.env via PUT /api/daemon/env. Saved values
 * apply only to a freshly-spawned daemon, so we surface an inline
 * "restart now" action that issues daemon.stop → daemon.start.
 */
export function SmithEnvForm() {
  const q = useSmithEnv();
  const put = usePutSmithEnv();
  const start = useStartJob();
  const [pull, setPull] = useState("");
  const [heartbeat, setHeartbeat] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data) {
      setPull(q.data.pullIntervalMs?.toString() ?? "");
      setHeartbeat(q.data.heartbeatIntervalMs?.toString() ?? "");
    }
  }, [q.data]);

  if (q.isLoading) {
    return (
      <Card>
        <div className="font-mono text-matrix-body">// loading env…</div>
      </Card>
    );
  }

  const pullParsed = parsePositiveInt(pull);
  const hbParsed = parsePositiveInt(heartbeat);
  const invalid = Number.isNaN(pullParsed) || Number.isNaN(hbParsed);

  const onSave = async () => {
    const payload: SmithEnv = {};
    if (typeof pullParsed === "number") payload.pullIntervalMs = pullParsed;
    if (typeof hbParsed === "number") payload.heartbeatIntervalMs = hbParsed;
    await put.mutateAsync(payload);
    setSaved(true);
  };

  const onRestart = async () => {
    await start.mutateAsync({ command: "daemon.stop" });
    await new Promise((r) => setTimeout(r, 800));
    await start.mutateAsync({ command: "daemon.start" });
    setSaved(false);
  };

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // daemon tuning (.env in $SMITH_HOME)
      </div>
      <div className="space-y-3">
        <FormField
          label="pull interval (ms)"
          hint={`ms between git pulls (default ${DEFAULT_PULL_MS}). leave blank to unset.`}
          type="text"
          inputMode="numeric"
          value={pull}
          placeholder={`${DEFAULT_PULL_MS}`}
          onChange={(e) => {
            setPull(e.target.value);
            setSaved(false);
          }}
        />
        <FormField
          label="heartbeat interval (ms)"
          hint={`ms between heartbeat writes (default ${DEFAULT_HEARTBEAT_MS}). leave blank to unset.`}
          type="text"
          inputMode="numeric"
          value={heartbeat}
          placeholder={`${DEFAULT_HEARTBEAT_MS}`}
          onChange={(e) => {
            setHeartbeat(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="mt-3 flex gap-2 items-center">
        <Button onClick={onSave} disabled={invalid || put.isPending}>
          save
        </Button>
        {invalid && (
          <span className="font-mono text-xs text-matrix-red">
            must be a positive integer or blank
          </span>
        )}
        {saved && !invalid && (
          <>
            <span className="font-mono text-xs text-matrix-green-muted">
              saved — restart daemon to apply
            </span>
            <Button variant="ghost" onClick={onRestart} disabled={start.isPending}>
              restart now
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
