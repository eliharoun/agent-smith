import type { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="border border-matrix-green-muted text-matrix-green-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest">
      {children}
    </span>
  );
}
