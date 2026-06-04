import { useState } from "react";
import { usePatchSettings, useSettings } from "@/hooks/useSettings";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { FormField } from "@/ui/FormField";

// Empty string in gui-state.json means "no preference" — the server
// resolves to ~/Downloads at export time. Show that as the default
// hint so users know what they get without changing anything.
const DEFAULT_HINT = "(default: ~/Downloads)";

function validatePath(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: "" };
  // Reject relative paths — they would resolve relative to whichever
  // cwd the smith server happens to have, which is opaque to the user.
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~")) {
    return { ok: false, error: "must be an absolute path or start with ~" };
  }
  return { ok: true, value: trimmed };
}

export function ExportDirSetting() {
  const s = useSettings();
  const patch = usePatchSettings();
  const current = s.data?.exportDir ?? "";
  const display = current.length > 0 ? current : DEFAULT_HINT;
  const [val, setVal] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const parsed = validatePath(val);
  const showValidation = touched && !parsed.ok;
  const saveDisabled = !parsed.ok || patch.isPending;
  const inputError = showValidation && !parsed.ok ? parsed.error : undefined;
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // export directory
      </div>
      <div className="font-mono text-sm text-matrix-body mb-2">current: {display}</div>
      <div className="flex gap-2 items-start">
        <FormField
          label="next save"
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="leave empty for ~/Downloads"
          {...(inputError ? { error: inputError } : {})}
        />
        <Button
          disabled={saveDisabled}
          onClick={() => {
            setTouched(true);
            if (parsed.ok) {
              patch.mutate(
                { exportDir: parsed.value },
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
        // applies to the next `smith agent export` from the GUI
      </p>
      {patch.isError && (
        <p className="font-mono text-[10px] text-matrix-amber mt-1">
          // error: {(patch.error as Error).message}
        </p>
      )}
    </Card>
  );
}
