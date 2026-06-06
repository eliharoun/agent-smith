import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useExportPlan } from "@/hooks/useExportPlan";
import { useExportRecents } from "@/hooks/useExportRecents";
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
  const [format, setFormat] = useState<"archive" | "directory">("archive");
  const [dirHintDismissed, setDirHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("smith.exportModal.directoryHintDismissed") === "1";
    } catch {
      return false;
    }
  });
  const [to, setTo] = useState<string>("");
  const [collision, setCollision] = useState<{ exists: boolean; modifiedAt?: string }>({ exists: false });
  const [collisionAcknowledged, setCollisionAcknowledged] = useState(false);

  const plan = useExportPlan(open ? name : null, format);
  const start = useStartJob();
  const { recents, add: addRecent } = useExportRecents(format);

  // Reset all state when the modal closes so reopening it starts fresh.
  useEffect(() => {
    if (!open) {
      setStep("plan");
      setIncludeSkills(true);
      setUserMd("stub");
      setJobId(null);
      setFormat("archive");
      setTo("");
      setCollision({ exists: false });
      setCollisionAcknowledged(false);
    }
  }, [open]);

  // Initialize `to` from the plan once ready — only if the user hasn't typed anything yet.
  useEffect(() => {
    if (plan.status === "ready" && plan.defaultExportDir && to === "") {
      setTo(plan.defaultExportDir);
    }
  }, [plan.status, plan.defaultExportDir, to]);

  // Collision preflight: check whether the destination already exists for directory exports.
  useEffect(() => {
    if (step !== "confirm" || format !== "directory" || !to) {
      setCollision({ exists: false });
      setCollisionAcknowledged(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ exists: boolean; modifiedAt?: string }>(
      `/api/agents/${encodeURIComponent(name)}/export/preflight-collision?path=${encodeURIComponent(to)}`,
      { method: "POST" },
    )
      .then((res) => {
        if (cancelled) return;
        setCollision(res);
        setCollisionAcknowledged(false);
      })
      .catch(() => {
        // Preflight failures shouldn't block the user — the CLI will surface them at export time.
        if (!cancelled) setCollision({ exists: false });
      });
    return () => {
      cancelled = true;
    };
  }, [step, format, to, name]);

  if (!open) return null;

  const continueDisabled =
    plan.status !== "ready" ||
    (step === "confirm" && format === "directory" && collision.exists && !collisionAcknowledged);

  function handleContinue() {
    if (step === "plan") {
      setStep("confirm");
    } else if (step === "confirm") {
      addRecent(to);
      start.mutate(
        {
          command: "agent.export",
          name,
          to,
          includeSkills,
          userMd,
          compression: "gzip",
          // Ask the CLI to emit a JSON line on stdout so we can parse the result.
          json: true,
          dryRun: false,
          stdout: false,
          format,
          withReadme: false,
          noManifest: false,
          force: collisionAcknowledged,
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
          <>
            <div role="group" aria-label="output format" className="flex gap-1 mb-3">
              {(["archive", "directory"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                  className={`px-3 py-1 border font-mono text-[10px] uppercase tracking-wider ${
                    format === f
                      ? "border-matrix-green text-matrix-green"
                      : "border-matrix-line text-matrix-body"
                  }`}
                >
                  {f === "archive" ? "Archive (.tgz)" : "Directory"}
                </button>
              ))}
            </div>
            {format === "directory" && !dirHintDismissed && (
              <div className="text-[10px] font-mono text-matrix-green-muted flex items-center gap-2 mb-3">
                <span>new: write loose files for committing into a git repo</span>
                <button
                  type="button"
                  aria-label="dismiss hint"
                  onClick={() => {
                    try {
                      localStorage.setItem("smith.exportModal.directoryHintDismissed", "1");
                    } catch {
                      // localStorage write can fail in private mode; UI stays open this session
                    }
                    setDirHintDismissed(true);
                  }}
                  className="text-matrix-green-muted hover:text-matrix-green"
                >
                  ×
                </button>
              </div>
            )}
          </>
        )}

        {step === "plan" && (
          <PlanStep
            plan={plan}
            includeSkills={includeSkills}
            setIncludeSkills={setIncludeSkills}
            userMd={userMd}
            setUserMd={setUserMd}
          />
        )}
        {step === "confirm" && (
          <ConfirmStep
            plan={plan}
            bundleName={name}
            to={to}
            setTo={setTo}
            format={format}
            recents={recents}
            collision={collision}
            collisionAcknowledged={collisionAcknowledged}
            setCollisionAcknowledged={setCollisionAcknowledged}
          />
        )}
        {step === "run" && <RunStep jobId={jobId} onClose={onClose} />}

        {step !== "run" && (
          <div className="flex gap-2 mt-4 justify-end">
            <Button onClick={onClose} variant="ghost">
              cancel
            </Button>
            <Button onClick={handleContinue} disabled={continueDisabled}>
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
  bundleName: string;
  to: string;
  setTo: (s: string) => void;
  format: "archive" | "directory";
  recents: string[];
  collision: { exists: boolean; modifiedAt?: string };
  collisionAcknowledged: boolean;
  setCollisionAcknowledged: (b: boolean) => void;
}

function ConfirmStep({
  plan,
  bundleName,
  to,
  setTo,
  format,
  recents,
  collision,
  collisionAcknowledged,
  setCollisionAcknowledged,
}: ConfirmStepProps) {
  if (plan.status !== "ready" || !plan.manifest) return null;
  const m = plan.manifest;
  const [showRecents, setShowRecents] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-matrix-body">
        exporting <span className="text-matrix-green">{m.bundle.name}</span>
      </p>
      <label className="flex flex-col gap-1 text-xs text-matrix-body font-mono">
        <span>save to:</span>
        <div className="relative">
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="save to path"
            className="w-full bg-black border border-matrix-line text-matrix-body px-2 py-1 font-mono text-xs"
          />
          {recents.length > 0 && (
            <button
              type="button"
              aria-label="recent destinations"
              onClick={() => setShowRecents((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-matrix-green-muted hover:text-matrix-green"
            >
              ▾
            </button>
          )}
          {showRecents && (
            <ul
              role="listbox"
              className="absolute right-0 top-full mt-1 bg-black border border-matrix-line z-10 min-w-[16rem]"
            >
              {recents.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => {
                      setTo(p);
                      setShowRecents(false);
                    }}
                    className="block w-full text-left px-2 py-1 hover:bg-matrix-bg-elev font-mono text-xs"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      {format === "directory" && (
        <p className="text-[10px] font-mono text-matrix-green-muted">
          ↳ will create {bundleName}/ inside this directory
        </p>
      )}
      {collision.exists && format === "directory" && (
        <div className="text-xs font-mono text-matrix-amber">
          warning: {bundleName}/ already exists
          {collision.modifiedAt && ` (modified ${new Date(collision.modifiedAt).toLocaleString()})`}
          <label className="flex items-center gap-2 mt-1">
            <input
              type="checkbox"
              checked={collisionAcknowledged}
              onChange={(e) => setCollisionAcknowledged(e.target.checked)}
            />
            overwrite existing files
          </label>
        </div>
      )}
      <Link
        to="/system/settings"
        className="text-matrix-green-muted underline hover:text-matrix-green text-[10px]"
      >
        change default in Settings ↗
      </Link>
    </div>
  );
}

type ExportResult =
  | { kind: "archive"; artifactPath: string; sha256: string; installCommand: string; size?: number }
  | { kind: "directory"; outputPath: string; filesWritten: string[] };

function parseExportResult(text: string): ExportResult | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof parsed.artifactPath === "string" &&
      typeof parsed.sha256 === "string" &&
      typeof parsed.installCommand === "string"
    ) {
      const archiveResult: ExportResult = {
        kind: "archive",
        artifactPath: parsed.artifactPath,
        sha256: parsed.sha256,
        installCommand: parsed.installCommand,
        ...(typeof parsed.size === "number" ? { size: parsed.size } : {}),
      };
      return archiveResult;
    }
    if (typeof parsed.outputPath === "string" && Array.isArray(parsed.filesWritten)) {
      return {
        kind: "directory",
        outputPath: parsed.outputPath,
        filesWritten: parsed.filesWritten.filter((s): s is string => typeof s === "string"),
      };
    }
    return null;
  } catch {
    return null;
  }
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
  const [copyGitDone, setCopyGitDone] = useState(false);

  // Parse the JSON completion line emitted by `smith agent export --json`.
  useEffect(() => {
    if (result) return;
    for (const ev of events) {
      if (ev.type === "stdout") {
        const parsed = parseExportResult(ev.chunk.trim());
        if (parsed) {
          setResult(parsed);
          return;
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

  if (result.kind === "archive") {
    const archiveResult = result;
    const shortSha = archiveResult.sha256.slice(0, 12);

    function handleCopy() {
      navigator.clipboard.writeText(archiveResult.installCommand).then(() => {
        setCopyDone(true);
        setTimeout(() => setCopyDone(false), 2000);
      });
    }

    function handleShowInFolder() {
      void apiFetch(`/api/fs/show?path=${encodeURIComponent(archiveResult.artifactPath)}`, {
        method: "POST",
      });
    }

    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-widest text-matrix-green">// exported</h3>
        <p className="text-xs text-matrix-body">
          saved to: <code className="text-matrix-green">{archiveResult.artifactPath}</code>
        </p>
        {archiveResult.size !== undefined && (
          <p className="text-xs text-matrix-body">
            {formatBytes(archiveResult.size)} · sha256:{shortSha}…
          </p>
        )}
        {archiveResult.size === undefined && (
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

  // kind === "directory"
  const dirResult = result;
  const parent = dirResult.outputPath.split("/").slice(0, -1).join("/");
  const baseName = dirResult.outputPath.split("/").pop() ?? "";
  const gitCmd = `cd ${parent} && git add ${baseName} && git commit -m "Add ${baseName} agent"`;

  function handleCopyGit() {
    navigator.clipboard.writeText(gitCmd).then(() => {
      setCopyGitDone(true);
      setTimeout(() => setCopyGitDone(false), 2000);
    });
  }

  function handleShowInFolder() {
    void apiFetch(`/api/fs/show?path=${encodeURIComponent(dirResult.outputPath)}`, {
      method: "POST",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-widest text-matrix-green">// exported</h3>
      <p className="text-xs text-matrix-body">
        saved to: <code className="text-matrix-green">{dirResult.outputPath}</code>
      </p>
      <p className="text-xs text-matrix-body">
        {dirResult.filesWritten.length} files written
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={handleCopyGit}>{copyGitDone ? "copied!" : "copy git commit command"}</Button>
        <Button onClick={handleShowInFolder}>show in folder</Button>
        <Button onClick={onClose} variant="ghost">
          close
        </Button>
      </div>
    </div>
  );
}
