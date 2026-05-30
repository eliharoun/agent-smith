import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border border-matrix-line bg-black/60 p-4 ${className}`}>
      {children}
    </section>
  );
}
