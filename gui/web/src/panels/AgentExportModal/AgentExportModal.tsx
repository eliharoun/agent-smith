import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useExportPlan } from "@/hooks/useExportPlan";
import { useJobStream } from "@/hooks/useJobStream";
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
  const [jobId, setJobId] = useState<string | null>(null);
  const plan = useExportPlan(open ? name : null);
  const start = useStartJob();

  // Reset all state when the modal closes so reopening it starts fresh.
  useEffect(() => {
    if (!open) {
      setStep("plan");
      setIncludeSkills(true);
      setUserMd("stub");
      setJobId(null);
    }
  }, [open]);

  if (!open) return null;

  const exportDir = plan.defaultExportDir ?? ".";

  function handleContinue() {
    if (step === "plan") {
      setStep("confirm");
    } else if (step === "confirm") {
      start.mutate(
        {
          command: "agent.export",
          name,
          to: exportDir,
          includeSkills,
          userMd,
          compression: "gzip",
          // Ask the CLI to emit a JSON line on stdout so we can parse the result.
          json: true,
          dryRun: false,
          stdout: false,
        },
        {
          onSuccess: (started) => {
            setJobId(started.jobId);
          },
        },
      );
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
        {step === "confirm" && <ConfirmStep plan={plan} />}
        {step === "run" && <RunStep jobId={jobId} onClose={onClose} />}

        {step !== "run" && (
          <div className="flex gap-2 mt-4 justify-end">
            <Button onClick={onClose} variant="ghost">
              cancel
            </Button>
            <Button onClick={handleContinue} disabled={plan.status !== "ready"}>
              continue
            </Button>
          </div>
        )}
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
}

function ConfirmStep({ plan }: ConfirmStepProps) {
  if (plan.status !== "ready" || !plan.manifest) return null;
  const m = plan.manifest;
  const exportDir = plan.defaultExportDir ?? ".";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-matrix-body">
        exporting <span className="text-matrix-green">{m.bundle.name}</span>
      </p>
      <div className="flex flex-col gap-1 text-xs text-matrix-body font-mono">
        <span>save to:</span>
        <span className="text-matrix-green">{exportDir}</span>
        <Link
          to="/system/settings"
          className="text-matrix-green-muted underline hover:text-matrix-green text-[10px]"
        >
          change default in Settings ↗
        </Link>
      </div>
    </div>
  );
}

interface ExportResult {
  artifactPath: string;
  sha256: string;
  installCommand: string;
  size?: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function RunStep({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const events = useJobStream(jobId ?? undefined);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  // Parse the JSON completion line emitted by `smith agent export --json`.
  useEffect(() => {
    if (result) return;
    for (const ev of events) {
      if (ev.type === "stdout") {
        try {
          const parsed = JSON.parse(ev.chunk.trim()) as Partial<ExportResult>;
          if (parsed.artifactPath && parsed.sha256 && parsed.installCommand) {
            setResult(parsed as ExportResult);
          }
        } catch {
          // stdout lines that are not JSON (e.g. progress text) are ignored
        }
      }
    }
  }, [events, result]);

  if (!jobId) return <div className="text-xs text-matrix-green-muted">// dispatching…</div>;

  if (!result) {
    return (
      <div className="text-xs text-matrix-green-muted">
        // exporting… (job {jobId.slice(0, 7)})
      </div>
    );
  }

  const shortSha = result.sha256.slice(0, 12);

  function handleCopy() {
    navigator.clipboard.writeText(result?.installCommand ?? "").then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }

  function handleShowInFolder() {
    void apiFetch(`/api/fs/show?path=${encodeURIComponent(result?.artifactPath ?? "")}`, {
      method: "POST",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-widest text-matrix-green">// exported</h3>
      <p className="text-xs text-matrix-body">
        saved to: <code className="text-matrix-green">{result.artifactPath}</code>
      </p>
      {result.size !== undefined && (
        <p className="text-xs text-matrix-body">
          {formatBytes(result.size)} · sha256:{shortSha}…
        </p>
      )}
      {result.size === undefined && (
        <p className="text-xs text-matrix-body">sha256:{shortSha}…</p>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={handleCopy}>{copyDone ? "copied!" : "copy install command"}</Button>
        <Button onClick={handleShowInFolder}>show in folder</Button>
        <Button onClick={onClose} variant="ghost">
          close
        </Button>
      </div>
    </div>
  );
}
