import type { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function FormField({ label, hint, error, className = "", id, ...rest }: Props) {
  const inputId = id ?? `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={inputId}
        className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted"
      >
        // {label}
      </label>
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
