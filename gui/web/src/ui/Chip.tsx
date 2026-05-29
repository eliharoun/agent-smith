import type { ReactNode } from "react";

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  const cls = {
    neutral: "border-matrix-line text-matrix-body",
    green: "border-matrix-green text-matrix-green",
    amber: "border-matrix-amber text-matrix-amber",
    red: "border-matrix-red text-matrix-red",
  }[tone];
  return (
    <span
      className={`inline-block px-2 py-0.5 border font-mono text-[10px] uppercase tracking-widest ${cls}`}
    >
      {children}
    </span>
  );
}
