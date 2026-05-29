import { useQueryClient } from "@tanstack/react-query";
import type { OnboardingStatus } from "gui-shared";
import { useEffect, useMemo, useState } from "react";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { usePatchSettings } from "@/hooks/useSettings";
import { MatrixRain } from "@/ui/MatrixRain";
import { DetectTools } from "./steps/DetectTools";
import { FirstAgent } from "./steps/FirstAgent";
import { Wake } from "./steps/Wake";
import { WhoAreYou } from "./steps/WhoAreYou";
import { YouAreIn } from "./steps/YouAreIn";

type StepId = "wake" | "whoareyou" | "detect" | "first-agent" | "youarein";

function computeRequired(
  onboarding: OnboardingStatus | undefined,
  statuses: Record<string, { installed: Record<string, boolean> }> | undefined,
): StepId[] | null {
  if (!onboarding || !statuses) return null;
  const list: StepId[] = [];
  if (onboarding.state === "FIRST_RUN") list.push("wake");
  if (onboarding.state === "FIRST_RUN" || onboarding.state === "NEEDS_USER_MD")
    list.push("whoareyou");
  const tools = onboarding.detectedTools;
  const anyTool = tools.opencode || tools.claudeCode || tools.codex;
  if (!anyTool) list.push("detect");
  const anyAgentInstalled = Object.values(statuses).some((s) =>
    Object.values(s.installed ?? {}).some((v) => v === true),
  );
  if (!anyAgentInstalled) list.push("first-agent");
  list.push("youarein"); // terminal step always present
  return list;
}

export function ConstructWizard() {
  const onboarding = useOnboardingStatus();
  const statuses = useInstalledStatuses();
  const patch = usePatchSettings();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const required = useMemo(
    () => computeRequired(onboarding.data, statuses.data),
    [onboarding.data, statuses.data],
  );

  // Clamp persistent step state when required shrinks (e.g., onboarding refetch
  // drops steps mid-wizard). Render-time clamp below handles the in-between
  // render; this effect fixes the state so subsequent advances start from a
  // valid index.
  useEffect(() => {
    if (!required) return;
    setStep((s) => Math.min(s, required.length - 1));
  }, [required]);

  const handleDone = async () => {
    await patch.mutateAsync({ tourCompleted: true });
    qc.invalidateQueries({ queryKey: ["onboarding"] });
  };

  let body: React.ReactNode;
  if (!required) {
    body = <p className="font-mono text-matrix-green-muted text-sm">// initializing…</p>;
  } else {
    const advance = () => setStep((s) => Math.min(s + 1, required.length - 1));
    // required always contains "youarein" (terminal step), so length >= 1.
    // Render-time clamp is defensive belt-and-suspenders: the useEffect above
    // corrects persistent step state, but it runs after this render, so we
    // also clamp the index used for picking the StepId here.
    const id = required[Math.min(step, required.length - 1)] ?? "youarein";
    body = renderStep(id, advance, handleDone);
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="absolute inset-0 opacity-30">
        <MatrixRain />
      </div>
      <div className="relative z-10 p-8">{body}</div>
    </div>
  );
}

function renderStep(id: StepId, onNext: () => void, onDone: () => Promise<void>): React.ReactNode {
  switch (id) {
    case "wake":
      return <Wake onNext={onNext} />;
    case "whoareyou":
      return <WhoAreYou onNext={onNext} />;
    case "detect":
      return <DetectTools onNext={onNext} />;
    case "first-agent":
      return <FirstAgent onNext={onNext} />;
    case "youarein":
      return <YouAreIn onDone={onDone} />;
  }
}
