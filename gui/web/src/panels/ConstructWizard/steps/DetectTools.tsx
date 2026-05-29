import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Lamp } from "@/ui/Lamp";

export function DetectTools({ onNext }: { onNext: () => void }) {
  const q = useOnboardingStatus();
  const t = q.data?.detectedTools ?? { opencode: false, claudeCode: false, codex: false };
  const any = t.opencode || t.claudeCode || t.codex;
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="font-mono text-matrix-green text-2xl uppercase tracking-widest">
        // detect your tools
      </h1>
      <Card>
        <ul className="space-y-2">
          <li className="flex items-center justify-between">
            opencode{" "}
            <Lamp status={t.opencode ? "on" : "off"} label={t.opencode ? "found" : "not found"} />
          </li>
          <li className="flex items-center justify-between">
            claude-code{" "}
            <Lamp
              status={t.claudeCode ? "on" : "off"}
              label={t.claudeCode ? "found" : "not found"}
            />
          </li>
          <li className="flex items-center justify-between">
            codex <Lamp status={t.codex ? "on" : "off"} label={t.codex ? "found" : "not found"} />
          </li>
        </ul>
      </Card>
      {!any && (
        <p className="text-matrix-amber text-sm">
          No supported tools detected. Install at least one of opencode, claude-code, or codex and
          re-run.
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!any}>
          Next
        </Button>
      </div>
    </div>
  );
}
