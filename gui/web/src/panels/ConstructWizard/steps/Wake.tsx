import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";

export function Wake({ onNext }: { onNext: () => void }) {
  const start = useStartJob();
  return (
    <div className="text-center max-w-lg">
      <h1 className="font-mono text-matrix-green text-3xl uppercase tracking-widest mb-4">
        // wake up
      </h1>
      <p className="text-matrix-body mb-6">
        Smith helps you build AI agents that run inside the coding tools you already use. We'll set
        up your local configuration and install your first agent. Takes about a minute.
      </p>
      <Button
        disabled={start.isPending}
        onClick={async () => {
          await start.mutateAsync({ command: "init" });
          onNext();
        }}
      >
        Begin
      </Button>
    </div>
  );
}
