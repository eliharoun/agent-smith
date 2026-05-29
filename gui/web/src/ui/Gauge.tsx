export function Gauge({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const C = 2 * Math.PI * 28;
  const dash = (v / 100) * C;
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="28" stroke="#143614" strokeWidth="4" fill="none" />
        <circle
          cx="40"
          cy="40"
          r="28"
          fill="none"
          stroke="#00ff41"
          strokeWidth="4"
          strokeDasharray={`${dash} ${C - dash}`}
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="44" textAnchor="middle" className="fill-matrix-green font-mono text-sm">
          {v}
        </text>
      </svg>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-matrix-body">
          {label}
        </span>
      )}
    </div>
  );
}
