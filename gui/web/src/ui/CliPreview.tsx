import { useState } from "react";
import { Button } from "./Button";

export function CliPreview({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="border border-matrix-green-muted bg-black/60 p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // CLI EQUIVALENT
      </div>
      <pre className="font-mono text-xs text-matrix-green whitespace-pre-wrap break-all">
        {command}
      </pre>
      <div className="flex justify-end gap-2 mt-2">
        <Button
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "copied" : "copy"}
        </Button>
      </div>
    </div>
  );
}
