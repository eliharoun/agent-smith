export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  "aria-label": ariaLabel,
}: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative w-10 h-5 border ${
          checked ? "border-matrix-green shadow-matrix-glow" : "border-matrix-line"
        } transition-shadow`}
      >
        <span
          className={`absolute top-0.5 ${checked ? "left-5 bg-matrix-green" : "left-0.5 bg-matrix-line"} w-4 h-4 transition-all`}
        />
      </button>
      {label && (
        <span className="font-mono text-xs uppercase tracking-wider text-matrix-body">{label}</span>
      )}
    </label>
  );
}
