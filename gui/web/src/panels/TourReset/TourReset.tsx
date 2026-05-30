import { usePatchSettings } from "@/hooks/useSettings";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

export function TourReset() {
  const patch = usePatchSettings();
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // onboarding tour
      </div>
      <Button variant="ghost" onClick={() => patch.mutate({ tourCompleted: false })}>
        Replay tour
      </Button>
    </Card>
  );
}
