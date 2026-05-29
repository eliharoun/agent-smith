import type { ReactNode } from "react";

export function Chrome({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h1 className="font-sans text-2xl text-matrix-green">{title}</h1>
        {subtitle && (
          <p className="font-mono text-[11px] uppercase tracking-widest text-matrix-green-muted mt-1">
            // {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
