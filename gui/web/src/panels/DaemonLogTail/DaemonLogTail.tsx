import { useEffect, useRef, useState } from "react";
import { getToken } from "@/api/client";
import { Card } from "@/ui/Card";
import { TerminalLog, type TerminalLogLine } from "@/ui/TerminalLog";

const MAX_LINES = 500;

function safeRegex(s: string): RegExp | null {
  try {
    return new RegExp(s, "i");
  } catch {
    return null;
  }
}

/**
 * Live tail of the daemon log via SSE (`/api/daemon/log/stream`). Filter
 * is a case-insensitive regex applied client-side. Buffer capped at
 * MAX_LINES to bound memory; on rotation the server emits a `truncated`
 * event that we surface as a system line.
 */
export function DaemonLogTail() {
  const [lines, setLines] = useState<TerminalLogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = getToken() ?? "";
    const url = `/api/daemon/log/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("line", (e: MessageEvent) => {
      setLines((prev) => {
        const next: TerminalLogLine[] = [...prev, { kind: "stdout", text: String(e.data) }];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
    es.addEventListener("truncated", () => {
      setLines((prev) => [
        ...prev,
        { kind: "system", text: "[truncated — log rotated or shrank]" },
      ]);
    });
    return () => {
      es.close();
    };
  }, []);

  const filterRe = filter ? safeRegex(filter) : null;
  const visible = filterRe ? lines.filter((l) => filterRe.test(l.text)) : lines;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // daemon log {connected ? "(live)" : "(disconnected)"}
        </div>
        <input
          type="text"
          placeholder="filter regex…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent border border-matrix-line px-2 py-1 font-mono text-xs w-48"
        />
      </div>
      <TerminalLog lines={visible} height={400} />
    </Card>
  );
}
