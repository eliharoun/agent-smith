import type { InputHTMLAttributes } from "react";
import { FieldHelp } from "./FieldHelp";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /**
   * Optional canonical field id (e.g. `knowledge.delivery`). When set, the
   * label is rendered through `<FieldHelp>` so an info icon + tooltip appear
   * next to it. If the registry has no entry for this id, the label degrades
   * gracefully (no icon, identical layout).
   */
  fieldId?: string;
}

export function FormField({ label, hint, error, className = "", id, fieldId, ...rest }: Props) {
  const inputId = id ?? `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {fieldId ? (
        <FieldHelp fieldId={fieldId} htmlFor={inputId}>
          {label}
        </FieldHelp>
      ) : (
        <label
          htmlFor={inputId}
          className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted"
        >
          // {label}
        </label>
      )}
      <input
        id={inputId}
        className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
        {...rest}
      />
      {hint && !error && (
        <span className="font-mono text-[10px] text-matrix-green-muted">{hint}</span>
      )}
      {error && <span className="font-mono text-[10px] text-matrix-red">{error}</span>}
    </div>
  );
}
