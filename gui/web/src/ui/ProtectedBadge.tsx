/**
 * Inline badge marking a system bundle managed by smith (agent-smith, the
 * bundled skills). Mirrors {@link Badge}'s structure but uses the matrix-amber
 * accent so it reads as informational, not an error state.
 */
export interface ProtectedBadgeProps {
  /** Override label; defaults to "Bundled". */
  label?: string;
}

export function ProtectedBadge({ label = "Bundled" }: ProtectedBadgeProps) {
  return (
    <span
      className="border border-matrix-amber text-matrix-amber px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest"
      title="Managed by smith — refresh with `smith update`"
      aria-label="Bundled with agent-smith"
    >
      {label}
    </span>
  );
}
