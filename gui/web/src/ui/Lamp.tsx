type Status = "on" | "warn" | "off" | "error";
const color: Record<Status, string> = {
  on: "bg-matrix-green shadow-matrix-glow",
  warn: "bg-matrix-amber",
  off: "bg-matrix-line",
  error: "bg-matrix-red",
};
export function Lamp({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full ${color[status]}`} />
      {label && (
        <span className="font-mono text-xs uppercase tracking-wider text-matrix-body">{label}</span>
      )}
    </span>
  );
}
