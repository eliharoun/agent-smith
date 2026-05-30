import { useEffect, useRef } from "react";

export interface TerminalLogLine {
  kind: "stdout" | "stderr" | "system";
  text: string;
}

export function TerminalLog({
  lines,
  height = 200,
}: {
  lines: TerminalLogLine[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll on lines update is intentional; lines triggers the effect by reference change
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className="border border-matrix-line bg-black/90 p-2 font-mono text-xs overflow-y-auto"
      style={{ height }}
    >
      {lines.map((l, i) => (
        <pre
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only log; stable order
          key={i}
          className={`whitespace-pre-wrap ${
            l.kind === "stderr"
              ? "text-matrix-red"
              : l.kind === "system"
                ? "text-matrix-amber"
                : "text-matrix-body"
          }`}
        >
          {l.text}
        </pre>
      ))}
    </div>
  );
}
