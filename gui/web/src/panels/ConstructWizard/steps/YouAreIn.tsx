import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";

export function YouAreIn({ onDone }: { onDone: () => Promise<void> }) {
  const nav = useNavigate();
  const [pending, setPending] = useState(false);

  const handle = async (path: string) => {
    if (pending) return;
    setPending(true);
    try {
      await onDone();
      nav(path, { replace: true });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="max-w-lg text-center space-y-4">
      <h1 className="font-mono text-matrix-green text-3xl uppercase tracking-widest">
        // you're in
      </h1>
      <p className="text-matrix-body">
        Your construct is online. Visit the Dashboard to see what's installed, or jump straight to
        Agents.
      </p>
      <div className="flex justify-center gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => handle("/agents")}>
          Agents
        </Button>
        <Button disabled={pending} onClick={() => handle("/")}>
          Dashboard
        </Button>
      </div>
    </div>
  );
}
