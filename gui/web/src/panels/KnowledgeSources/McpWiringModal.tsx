import { useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { Button } from "@/ui/Button";

export interface PlatformMcpStatus {
  platform: "opencode" | "claude-code" | "codex" | "kiro";
  cliInstalled: boolean;
  configPath: string;
  hasEntry: boolean;
  configReadable: boolean;
}

interface WiringPlanResponse {
  platforms: PlatformMcpStatus[];
  /**
   * Whether the bundle's `mcpServers` array currently includes this
   * agent's per-agent server key. Drives the "+ add / - remove
   * mcpServers entry" line and the no-op detection — both of which
   * used to be hardcoded against the singleton `agent-smith-knowledge`
   * key and rendered unconditionally.
   */
  bundleHasEntry: boolean;
}

const PLATFORM_LABELS: Record<PlatformMcpStatus["platform"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
  kiro: "Kiro",
};

export interface McpWiringModalProps {
  agent: string;
  /** ON = wire, OFF = unwire. */
  enable: boolean;
  onCancel: () => void;
  /**
   * Called with the list of platforms the user actually wants to apply the
   * change to (only `cliInstalled` ones, by default). The parent dispatches
   * the multi-step chain (config patch → wiring → install).
   */
  onConfirm: (platforms: PlatformMcpStatus["platform"][]) => void;
}

/**
 * Pre-flight confirmation modal for the MCP wiring toggle. Fetches the
 * server's wiring plan (per-platform CLI detection + current entry state)
 * and renders an itemised list of what *will* be written or removed. The
 * actual write happens after the user clicks the confirm button — this
 * modal is purely informational + consent.
 */
export function McpWiringModal({ agent, enable, onCancel, onConfirm }: McpWiringModalProps) {
  const [plan, setPlan] = useState<WiringPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<WiringPlanResponse>(
      `/api/agents/${encodeURIComponent(agent)}/mcp-wiring-plan`,
    )
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [agent]);

  const verb = enable ? "Wire" : "Unwire";
  // Targets = platforms with the CLI on PATH AND a state change is needed
  // (enable+!hasEntry, or disable+hasEntry). This avoids no-op writes.
  const targets = plan
    ? plan.platforms.filter((p) => p.cliInstalled && (enable ? !p.hasEntry : p.hasEntry))
    : [];

  // Whether the bundle's `mcpServers` array itself needs to change. When
  // null, the desired entry is already in the desired state (present for
  // enable=true, absent for enable=false) and the parent will skip the
  // PUT /config + agent.install dispatch entirely.
  const bundleConfigChange: "add" | "remove" | null = plan
    ? enable && !plan.bundleHasEntry
      ? "add"
      : !enable && plan.bundleHasEntry
        ? "remove"
        : null
    : null;

  // True no-op: nothing to write to the bundle, nothing to wire on disk.
  // Render a Close-only button instead of confirm.
  const isTrueNoop = plan !== null && bundleConfigChange === null && targets.length === 0;

  // Confirm-button label. Three cases:
  //   - bundle change + N targets → "Wire/Unwire N platforms"
  //   - bundle change only → "Save bundle config"
  //   - targets only (rare; bundle already in desired state) → "Wire/Unwire N platforms"
  let confirmLabel: string;
  if (bundleConfigChange !== null && targets.length === 0) {
    confirmLabel = "Save bundle config";
  } else {
    confirmLabel = `${verb} ${targets.length} platform${targets.length === 1 ? "" : "s"}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-green bg-black p-6 w-full max-w-2xl">
        <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm mb-3">
          // {verb} knowledge MCP server for {agent}?
        </h2>
        {error && (
          <div className="font-mono text-xs text-matrix-red mb-3">// failed to load plan: {error}</div>
        )}
        {!plan && !error && (
          <div className="font-mono text-xs text-matrix-body mb-3">// loading plan…</div>
        )}
        {plan && isTrueNoop && (
          <div className="font-mono text-xs text-matrix-body mb-4">
            // already in the desired state — nothing to do.
          </div>
        )}
        {plan && !isTrueNoop && (
          <div className="space-y-3 text-xs font-mono text-matrix-body mb-4">
            {bundleConfigChange !== null && (
              <div>
                <div className="text-matrix-green-muted uppercase tracking-widest text-[10px] mb-1">
                  // bundle config
                </div>
                <div className="ml-3">
                  {bundleConfigChange === "add" ? "+ " : "- "}
                  <code>mcpServers</code>:{" "}
                  {bundleConfigChange === "add" ? "add " : "remove "}
                  <code>"{agent}-knowledge"</code>
                </div>
              </div>
            )}
            <div>
              <div className="text-matrix-green-muted uppercase tracking-widest text-[10px] mb-1">
                // ai client mcp configs
              </div>
              <ul className="ml-3 space-y-1">
                {plan.platforms.map((p) => {
                  const isTarget = targets.includes(p);
                  let mark: string;
                  let note: string;
                  if (!p.cliInstalled) {
                    mark = "⊘";
                    note = "CLI not detected — skipped";
                  } else if (enable && p.hasEntry) {
                    mark = "✓";
                    note = "already wired — no change";
                  } else if (!enable && !p.hasEntry) {
                    mark = "✓";
                    note = "not wired — no change";
                  } else {
                    mark = enable ? "+" : "-";
                    note = enable ? "will add" : "will remove";
                  }
                  return (
                    <li key={p.platform} className={isTarget ? "" : "text-matrix-green-muted"}>
                      <span className="inline-block w-4">{mark}</span>{" "}
                      <span className="inline-block w-28">{PLATFORM_LABELS[p.platform]}</span>{" "}
                      <code>{p.configPath}</code>{" "}
                      <span className="text-matrix-green-muted">({note})</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {bundleConfigChange !== null && (
              <div>
                <div className="text-matrix-green-muted uppercase tracking-widest text-[10px] mb-1">
                  // followup
                </div>
                <div className="ml-3">
                  bundle reinstalled via <code>smith agent install {agent}</code> so rendered
                  files reflect the new <code>mcpServers</code> entry.
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {isTrueNoop ? (
            <Button onClick={onCancel}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                disabled={!plan || error !== null}
                onClick={() => onConfirm(targets.map((t) => t.platform))}
              >
                {confirmLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
