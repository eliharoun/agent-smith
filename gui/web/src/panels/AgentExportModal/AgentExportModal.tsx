import { useEffect, useState } from "react";
import { useExportPlan } from "@/hooks/useExportPlan";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";

interface Props {
  name: string;
  open: boolean;
  onClose: () => void;
}

type Step = "plan" | "confirm" | "run";

export function AgentExportModal({ name, open, onClose }: Props) {
  const [step, setStep] = useState<Step>("plan");
  const [includeSkills, setIncludeSkills] = useState(true);
  const [userMd, setUserMd] = useState<"stub" | "keep" | "reject">("stub");
  const [to, setTo] = useState(".");
  const plan = useExportPlan(open ? name : null);
  const start = useStartJob();

  // Reset all state when the modal closes so reopening it starts fresh.
  useEffect(() => {
    if (!open) {
      setStep("plan");
      setIncludeSkills(true);
      setUserMd("stub");
      setTo(".");
    }
  }, [open]);

  if (!open) return null;

  function handleContinue() {
    if (step === "plan") {
      setStep("confirm");
    } else if (step === "confirm") {
      start.mutate({
        command: "agent.export",
        name,
        to,
        includeSkills,
        userMd,
        compression: "gzip",
        json: false,
        dryRun: false,
        stdout: false,
      });
      setStep("run");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <div className="border border-matrix-green bg-black p-6 w-[42rem] max-w-[92vw] font-mono max-h-[80vh] overflow-y-auto">
        <h2 className="text-matrix-green text-sm uppercase tracking-widest mb-4">
          // export agent
        </h2>

        {step === "plan" && (
          <PlanStep
            plan={plan}
            includeSkills={includeSkills}
            setIncludeSkills={setIncludeSkills}
            userMd={userMd}
            setUserMd={setUserMd}
          />
        )}
        {step === "confirm" && <ConfirmStep plan={plan} to={to} setTo={setTo} />}
        {step === "run" && <RunStep />}

        <div className="flex gap-2 mt-4 justify-end">
          <Button onClick={onClose} variant="ghost">
            cancel
          </Button>
          <Button
            onClick={handleContinue}
            disabled={plan.status !== "ready" || step === "run"}
          >
            continue
          </Button>
        </div>
      </div>
    </div>
  );
}

interface PlanStepProps {
  plan: ReturnType<typeof useExportPlan>;
  includeSkills: boolean;
  setIncludeSkills: (b: boolean) => void;
  userMd: "stub" | "keep" | "reject";
  setUserMd: (v: "stub" | "keep" | "reject") => void;
}

function PlanStep({ plan, includeSkills, setIncludeSkills, userMd, setUserMd }: PlanStepProps) {
  if (plan.status === "loading") {
    return <div className="text-xs text-matrix-green-muted">// loading plan…</div>;
  }
  if (plan.status === "error") {
    return (
      <div className="text-xs text-matrix-red">
        failed to load plan: {plan.error}
      </div>
    );
  }
  if (plan.status !== "ready" || !plan.manifest) {
    return <div className="text-xs text-matrix-green-muted">// plan: {plan.status}</div>;
  }
  const m = plan.manifest;
  return (
    <div className="flex flex-col gap-3">
      <ul className="text-xs text-matrix-body space-y-1">
        <li>
          bundle: <span className="text-matrix-green">{m.bundle.name}</span>
        </li>
        <li>skills declared: {m.requires.skills.length}</li>
        <li>mcp servers required: {m.requires.mcpServers.required.length}</li>
        <li>remote knowledge sources: {m.requires.remoteKnowledge.length}</li>
      </ul>
      <label className="flex items-center gap-2 text-xs text-matrix-body font-mono">
        <input
          type="checkbox"
          checked={includeSkills}
          onChange={(e) => setIncludeSkills(e.target.checked)}
        />
        embed required skills
      </label>
      <label className="flex items-center gap-2 text-xs text-matrix-body font-mono">
        user.md:
        <select
          value={userMd}
          onChange={(e) => setUserMd(e.target.value as "stub" | "keep" | "reject")}
          className="bg-black border border-matrix-line text-matrix-body px-1 py-0.5"
        >
          <option value="stub">stub (default)</option>
          <option value="keep">keep</option>
          <option value="reject">reject if not stub</option>
        </select>
      </label>
    </div>
  );
}

interface ConfirmStepProps {
  plan: ReturnType<typeof useExportPlan>;
  to: string;
  setTo: (s: string) => void;
}

function ConfirmStep({ plan, to, setTo }: ConfirmStepProps) {
  if (plan.status !== "ready" || !plan.manifest) return null;
  const m = plan.manifest;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-matrix-body">
        exporting <span className="text-matrix-green">{m.bundle.name}</span>
      </p>
      <label className="flex flex-col gap-1 text-xs text-matrix-body font-mono">
        output directory:
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="bg-black border border-matrix-line text-matrix-body px-2 py-1 font-mono"
        />
      </label>
    </div>
  );
}

function RunStep() {
  return (
    <div className="text-xs text-matrix-green-muted">
      // job dispatched — watch the job stream for progress
    </div>
  );
}
