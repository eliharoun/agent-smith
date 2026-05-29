import type { ReactNode } from "react";

interface Props {
  columns: string;
  className?: string;
  children: ReactNode;
}

export function ListRow({ columns, className, children }: Props) {
  return (
    <li
      style={{ gridTemplateColumns: columns }}
      className={`grid items-center gap-3 ${className ?? ""}`}
    >
      {children}
    </li>
  );
}
