import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { jobsApi } from "@/api/jobs";
import { useJackOutDryRun } from "@/hooks/useJackOutDryRun";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { MatrixRain } from "@/ui/MatrixRain";
import { TerminalLog, type TerminalLogLine } from "@/ui/TerminalLog";
import { TypedTokenModal } from "@/ui/TypedTokenModal";
import { useJackOutMachine } from "./useJackOutMachine";

/**
 * Four-stage jack-out flow: `warning` (dry-run preview) →
 * `confirming` (typed-token modal) → `running` (MatrixRain + live log) →
 * `succeeded` | `failed`.
 *
 * Bypasses `useStartJob`/`JobStreamModal` on purpose: this screen takes
 * over the viewport, and we don't want the global active-jobs modal to
 * compete for the running stage. The state machine subscribes to the
 * job's SSE stream directly via `subscribe(jobId)`.
 *
 * The CLI confirm token is literally `jack-out` (hyphen) — see plan
 * Amendment B; this matches the CLI prompt in `src/cli/commands/jack-out.ts`.
 */
export function JackOutScreen() {
  const dry = useJackOutDryRun();
  const { state, dispatch, subscribe } = useJackOutMachine();
  const [logLines, setLogLines] = useState<TerminalLogLine[]>([]);

  const startMutation = useMutation({
    mutationFn: () => jobsApi.start({ command: "jack-out", confirmPhrase: "jack-out" }),
    onSuccess: ({ jobId }) => {
      dispatch({ type: "spawned", jobId });
      subscribe(jobId, (text) => {
        setLogLines((p) => [...p, { kind: "stdout" as const, text }].slice(-200));
      });
    },
    onError: (err) => {
      dispatch({ type: "fail", message: err instanceof Error ? err.message : String(err) });
    },
  });

  // ─── succeeded ───────────────────────────────────────────────
  if (state.stage === "succeeded") {
    return (
      <div className="fixed inset-0 bg-black">
        <MatrixRain className="absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="border border-matrix-green bg-black/80 p-6 max-w-xl text-center">
            <div className="font-mono text-matrix-green text-xl mb-3">
              You have left the matrix.
            </div>
            <div className="font-mono text-matrix-green-muted text-sm mb-4">
              Close this tab. To reinstall:
            </div>
            <code className="block font-mono text-xs bg-black/60 p-2 select-all text-matrix-body">
              gh repo clone eliharoun/agent-smith ~/.agent-smith &amp;&amp; bash
              ~/.agent-smith/bin/install
            </code>
          </div>
        </div>
      </div>
    );
  }

  // ─── failed ──────────────────────────────────────────────────
  if (state.stage === "failed") {
    return (
      <div className="p-6">
        <Card>
          <div className="font-mono text-matrix-red mb-2">// jack-out failed</div>
          <div className="font-mono text-sm text-matrix-body mb-3">{state.errorMessage}</div>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            retry
          </Button>
        </Card>
      </div>
    );
  }

  // ─── running ─────────────────────────────────────────────────
  if (state.stage === "running") {
    return (
      <div className="fixed inset-0 bg-black">
        <MatrixRain className="absolute inset-0" />
        <div className="absolute bottom-6 left-6 right-6">
          <TerminalLog lines={logLines} height={170} />
        </div>
      </div>
    );
  }

  // ─── warning + confirming share the same scaffold ────────────
  return (
    <div className="p-6 max-w-3xl">
      <Card>
        <div className="font-mono text-matrix-red text-lg mb-3">// jack out — full uninstall</div>
        <div className="font-mono text-sm text-matrix-body mb-3 space-y-2">
          <p className="text-matrix-amber font-bold uppercase tracking-wider text-xs">
            ⚠ This permanently uninstalls smith and everything it manages.
          </p>
          <p>You are about to:</p>
          <ul className="list-none pl-0 space-y-1 text-matrix-body">
            <li>
              <span className="text-matrix-red">›</span> delete the{" "}
              <code className="text-matrix-amber">smith</code> CLI binary (the symlink in your PATH)
            </li>
            <li>
              <span className="text-matrix-red">›</span> delete the entire smith source clone and
              the <code className="text-matrix-amber">~/.agent-smith</code> config directory
            </li>
            <li>
              <span className="text-matrix-red">›</span> uninstall every smith-managed agent and
              skill from <strong>Claude Code, OpenCode, and Codex</strong>
            </li>
            <li>
              <span className="text-matrix-red">›</span> remove smith's PATH wiring from your shell
              rc file
            </li>
            <li>
              <span className="text-matrix-red">›</span> kill this GUI server (the page will
              disconnect mid-uninstall — that is expected)
            </li>
          </ul>
          <p className="text-matrix-red font-bold pt-2">
            This is irreversible. The exact items targeted are listed below — review them before
            continuing.
          </p>
        </div>
        {dry.isLoading && (
          <div className="font-mono text-xs text-matrix-green-muted">// loading dry-run…</div>
        )}
        {dry.error && (
          <div className="font-mono text-xs text-matrix-red">
            // dry-run failed: {String(dry.error)}
          </div>
        )}
        {dry.data && (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-amber mb-1">
              // exact removal target ({dry.data.lines.length} paths)
            </div>
            <pre className="font-mono text-xs mb-3 max-h-60 overflow-y-auto text-matrix-body whitespace-pre-wrap border border-matrix-line/40 bg-black/40 p-2">
              {dry.data.rawOutput}
            </pre>
          </>
        )}
        <Button variant="danger" onClick={() => dispatch({ type: "confirm" })} disabled={!dry.data}>
          I understand — continue…
        </Button>
      </Card>
      {state.stage === "confirming" && (
        <TypedTokenModal
          title="Permanently uninstall smith?"
          body={
            <div className="space-y-3">
              <p className="font-mono text-sm text-matrix-red font-bold">
                Last chance. This will destroy the smith CLI and every agent + skill it manages
                across Claude Code, OpenCode, and Codex. It cannot be undone.
              </p>
              <p className="font-mono text-sm">Type the exact phrase below to confirm.</p>
              <p className="font-mono text-xs text-matrix-amber">
                The GUI server will die mid-uninstall — disconnect is expected and means the removal
                ran successfully.
              </p>
            </div>
          }
          expectedToken="jack-out"
          confirmLabel="Jack Out"
          onCancel={() => dispatch({ type: "cancel" })}
          onConfirm={() => startMutation.mutate()}
        />
      )}
    </div>
  );
}
