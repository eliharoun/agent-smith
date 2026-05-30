import { type ReactNode, useEffect, useState } from "react";

interface Props {
  label: string;
  count: number;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}

function readPersisted(key: string | undefined): boolean | undefined {
  if (!key || typeof localStorage === "undefined") return undefined;
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  return raw === "1";
}

export function CollapsibleCatalogGroup({
  label,
  count,
  defaultOpen = true,
  storageKey,
  children,
}: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    const persisted = readPersisted(storageKey);
    return persisted ?? defaultOpen;
  });
  useEffect(() => {
    if (!storageKey || typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey, open ? "1" : "0");
  }, [open, storageKey]);
  return (
    <section className="border-b border-matrix-line py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted hover:text-matrix-green"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>◆ {label}</span>
        <span className="px-1 border border-matrix-line text-matrix-green">{count}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}
