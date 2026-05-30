import { useState } from "react";
import { usePatchSettings, useSettings } from "@/hooks/useSettings";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { FormField } from "@/ui/FormField";

function validatePort(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "port required" };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "must be a whole number" };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { ok: false, error: "must be 1–65535" };
  }
  return { ok: true, value: n };
}

export function PortSetting() {
  const s = useSettings();
  const patch = usePatchSettings();
  const [val, setVal] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const current = s.data?.port ?? 7777;
  const parsed = validatePort(val);
  const showValidation = touched && !parsed.ok;
  const saveDisabled = !parsed.ok || patch.isPending;
  const inputError = showValidation && !parsed.ok ? parsed.error : undefined;
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // preferred port
      </div>
      <div className="font-mono text-sm text-matrix-body mb-2">current: {current}</div>
      <div className="flex gap-2 items-start">
        <FormField
          label="next launch"
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => setTouched(true)}
          {...(inputError ? { error: inputError } : {})}
        />
        <Button
          disabled={saveDisabled}
          onClick={() => {
            setTouched(true);
            if (parsed.ok) {
              patch.mutate(
                { port: parsed.value },
                {
                  onSuccess: () => {
                    setVal("");
                    setTouched(false);
                  },
                },
              );
            }
          }}
        >
          {patch.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="font-mono text-[10px] text-matrix-green-muted mt-2">
        // applies on next `smith gui` launch
      </p>
      {patch.isError && (
        <p className="font-mono text-[10px] text-matrix-amber mt-1">
          // error: {(patch.error as Error).message}
        </p>
      )}
    </Card>
  );
}
