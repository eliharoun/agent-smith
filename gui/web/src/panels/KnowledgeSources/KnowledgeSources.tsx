import type { KnowledgeSource, Platform as PlatformId } from "gui-shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { agentsApi } from "@/api/agents";
import { useAgent, useSaveAgentConfig } from "@/hooks/useAgents";
import { useGrantRefreshConsent, useKnowledge } from "@/hooks/useKnowledge";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Toggle } from "@/ui/Toggle";
import { TypedTokenModal } from "@/ui/TypedTokenModal";
import { AddKnowledgeSourceModal } from "./AddKnowledgeSourceModal";
import { EditKnowledgeSourceModal } from "./EditKnowledgeSourceModal";
import { KnowledgeSourceRow } from "./KnowledgeSourceRow";
import { McpWiringModal } from "./McpWiringModal";
import { RefreshConsentBanner } from "./RefreshConsentBanner";

/** Canonical name of the bundled MCP server the toggle owns. */
const MCP_SERVER_KEY = "agent-smith-knowledge";

/**
 * Reads the current `mcpServers` array from the agent detail config (loose
 * shape — see AgentDetail in gui-shared). Returns an empty array if absent
 * or malformed so callers can spread/merge safely. Strings only — anything
 * else is dropped (the canonical schema requires `string[]`; the GUI is
 * defensive against bundles authored by older tooling).
 */
function readMcpServers(config: Record<string, unknown> | undefined): string[] {
  const block = config?.mcpServers;
  if (Array.isArray(block)) {
    return block.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

interface Props {
  agent: string;
}

/**
 * Per-agent knowledge sources editor. Mounted inside `AgentEditorTabs`
 * (Knowledge tab, wired in Task 29) AND as the body of `/knowledge/:agent`.
 *
 * Data: `useKnowledge(agent)` returns AgentKnowledgeView — sources joined
 * with their manifest entry + per-source refresh-cache file.
 *
 * MCP wiring toggle (Task v2.1-D): adds/removes the
 * `"agent-smith-knowledge"` entry in the bundle's `mcpServers: string[]`
 * (canonical config — a list of server *names* the agent expects to be
 * available; spawn config lives in the user's AI-client global MCP config).
 * Replaces the v2.0 fire-and-forget "serve" button (which spawned a debug
 * process); the new toggle is the persistent, declarative way to declare
 * the knowledge MCP server as a dependency. The CLI's `smith knowledge
 * serve` command is unchanged (still useful from the terminal for
 * debugging).
 *
 * Jobs dispatched:
 *   - knowledge.fetch  (refresh; optional `source` filter)
 *   - knowledge.add    (positional typeOrUrl + pathOrUrl per the CLI shape)
 *   - knowledge.remove (typed-token confirmed)
 *
 * Consent: AgentKnowledgeView.consent is `undefined` until granted; the
 * RefreshConsentBanner renders when consent is missing. Note: the GUI
 * does not (yet) write `RefreshConsentManifest` directly — clicking
 * "Authorize and refresh" dispatches knowledge.fetch and lets the CLI
 * prompt/grant in-band via its existing consent flow. (Future: a
 * dedicated PUT /api/knowledge/:agent/consent route would let the GUI
 * grant non-interactively.)
 *
 * JobCompletionListener (Task 19) invalidates ['knowledge', agent] on
 * knowledge.* exit, so the list refreshes after add/remove/fetch.
 */
export function KnowledgeSources({ agent }: Props) {
  const q = useKnowledge(agent);
  // The editor PUTs `agent.config.knowledge` whole, so it needs the rest of
  // the block (packs / inlineBudget / compile / un-edited sources) to
  // round-trip without dropping fields. The view from /api/knowledge
  // already includes per-source `delivery` etc., but not the surrounding
  // bundle-level fields, so we pull from /api/agents/:name here.
  const detail = useAgent(agent);
  const start = useStartJob();
  const grantConsent = useGrantRefreshConsent(agent);
  const saveConfig = useSaveAgentConfig(agent);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<KnowledgeSource | null>(null);
  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const [refreshAllConfirm, setRefreshAllConfirm] = useState(false);

  // MCP wiring toggle state (Task v2.1-D / v2.1-E).
  // The toggle reflects whether the bundle's `mcpServers: string[]` array
  // contains "agent-smith-knowledge": present → ON, absent → OFF. We read
  // from the agent detail (which the panel already fetches for the
  // per-source editor). On flip the panel:
  //   1. opens a confirmation modal listing exactly which AI-client MCP
  //      configs will be touched (via GET /mcp-wiring-plan);
  //   2. on confirm: PUT /config (mcpServers array) → POST /mcp-wiring →
  //      dispatch agent.install. Failure mid-chain reverts the optimistic
  //      flip and surfaces the error inline.
  const config = detail.data?.config as Record<string, unknown> | undefined;
  const mcpServers = readMcpServers(config);
  const savedOn = mcpServers.includes(MCP_SERVER_KEY);
  // Optimistic flag for in-flight flip — the switch animates instantly
  // when the user clicks, and we revert if the chain fails or the modal
  // is cancelled. Cleared when the refetched config catches up (so the
  // toggle reflects ground truth after save).
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (optimisticOn !== null && optimisticOn === savedOn) setOptimisticOn(null);
  }, [optimisticOn, savedOn]);
  const mcpOn = optimisticOn ?? savedOn;
  // Confirmation modal: when non-null, shows the wiring plan + confirm
  // button. `enable` is the desired direction of the flip.
  const [pendingFlip, setPendingFlip] = useState<{ enable: boolean } | null>(null);
  // Multi-step chain progress. When non-null, the toggle is locked and
  // the body shows a small status line.
  const [chainStep, setChainStep] = useState<
    "config" | "wiring" | "install" | null
  >(null);
  const [chainError, setChainError] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <Section title={agent}>
        <div className="font-mono text-sm text-matrix-body">// loading knowledge…</div>
      </Section>
    );
  }
  if (q.isError) {
    return (
      <Section title={agent}>
        <div className="font-mono text-sm text-matrix-red">
          // failed to load knowledge — {(q.error as Error).message}
        </div>
        <Button variant="ghost" onClick={() => q.refetch()}>
          retry
        </Button>
      </Section>
    );
  }

  const view = q.data!;
  const consentGranted = view.consent != null;
  const sources = view.sources;
  const empty = sources.length === 0;
  // The consent banner only matters when at least one source could
  // actually trigger the operations the consent governs (network
  // requests, git fetches). Local-file/glob/dir sources with no refresh
  // mode are inert at refresh time, so prompting for consent is
  // confusing — the bundled agent-smith companion (single `dir` source
  // delivered as `file`) hit this case and showed the banner forever
  // even though "refresh" was a no-op.
  const NETWORK_TYPES = new Set(["url", "git", "confluence", "jira"]);
  const REFRESH_MODES = new Set(["session", "always"]);
  const needsConsent = sources.some(
    (j) =>
      NETWORK_TYPES.has(j.source.type) ||
      (j.source.refresh && REFRESH_MODES.has(String(j.source.refresh))),
  );

  // Click handler: open the confirmation modal. Optimistic state is set
  // here so the visual flip happens immediately; the modal is what gates
  // the actual writes. Cancelling the modal reverts the optimistic flip.
  function flipMcpToggle(next: boolean) {
    if (chainStep !== null) return;
    setOptimisticOn(next);
    setPendingFlip({ enable: next });
  }

  function cancelFlip() {
    setPendingFlip(null);
    setOptimisticOn(null);
    setChainError(null);
  }

  /**
   * Multi-step orchestration triggered when the user confirms the modal.
   *  1. PUT /config — write the canonical mcpServers array.
   *  2. POST /mcp-wiring — write/remove spawn config across detected
   *     AI clients (only the platforms the modal selected).
   *  3. Dispatch agent.install — rebuild the rendered files.
   * Per-platform write failures are reported by the wiring endpoint and
   * surfaced as a non-blocking warning; the chain continues to install.
   */
  async function applyMcpWiring(enable: boolean, platforms: PlatformId[]) {
    setChainError(null);
    const without = mcpServers.filter((n) => n !== MCP_SERVER_KEY);
    const nextArray = enable ? [...without, MCP_SERVER_KEY] : without;
    setChainStep("config");
    try {
      await saveConfig.mutateAsync({ mcpServers: nextArray });
    } catch (err) {
      setChainError(`config save failed: ${(err as Error).message}`);
      setChainStep(null);
      setOptimisticOn(null);
      return;
    }
    if (platforms.length > 0) {
      setChainStep("wiring");
      try {
        const res = await agentsApi.applyMcpWiring(agent, { enable, platforms });
        const failures = res.results.filter((r) => !r.ok);
        if (failures.length > 0) {
          // Partial-success: keep the chain going (the user can retry the
          // failing platforms by toggling again — writes are idempotent).
          setChainError(
            `wiring failed on: ${failures
              .map((f) => `${f.platform} (${f.error ?? "unknown"})`)
              .join(", ")}`,
          );
        }
      } catch (err) {
        setChainError(`wiring failed: ${(err as Error).message}`);
        setChainStep(null);
        setOptimisticOn(null);
        return;
      }
    }
    // platforms.length === 0 means "every platform is already in the
    // desired state" or "no CLIs detected" — still run install so the
    // bundle's rendered files reflect the new mcpServers entry.
    setChainStep("install");
    try {
      // useStartJob is fire-and-forget (returns jobId immediately). The
      // existing JobCompletionListener invalidates queries when the job
      // finishes, so the toggle's saved state catches up automatically.
      // Targets are derived from the bundle's `targets` (canonical list);
      // the install command without --platforms picks them up by default.
      await start.mutateAsync({
        command: "agent.install",
        name: agent,
        platforms: (detail.data?.targets ?? []) as PlatformId[],
        withSkills: false,
      });
    } catch (err) {
      setChainError(`install dispatch failed: ${(err as Error).message}`);
      setChainStep(null);
      return;
    }
    setChainStep(null);
    setPendingFlip(null);
  }

  return (
    <Section
      title={agent}
      headerActions={
        <div className="flex items-center gap-3">
          {/*
           * T11/v2.1-D: compile (build the knowledge dir) + MCP wiring
           * toggle (expose it to AI clients). Compile is disabled when
           * there are zero sources — nothing to index. The toggle is
           * orthogonal: a user can wire MCP first and add sources later;
           * the empty-corpus case still produces a useful empty index.
           */}
          <Button
            variant="ghost"
            disabled={empty}
            onClick={() => start.mutate({ command: "knowledge.compile", name: agent })}
          >
            compile
          </Button>
          <Toggle
            checked={mcpOn}
            disabled={chainStep !== null}
            onChange={flipMcpToggle}
            label="mcp wiring"
            aria-label="knowledge mcp server wiring"
          />
          <Button variant="ghost" disabled={empty} onClick={() => setRefreshAllConfirm(true)}>
            refresh all
          </Button>
          <Button onClick={() => setAddOpen(true)}>+ add source</Button>
        </div>
      }
    >
      {/*
       * MCP toggle helper text — sets expectations for what the toggle
       * does without crowding the header. Spawned-by-AI-client semantics
       * are easy to miss; the helper text makes it concrete.
       */}
      <div className="font-mono text-[10px] text-matrix-green-muted -mt-1 mb-3">
        // mcp wiring: spawned by ai clients (claude code, opencode, etc.) to expose{" "}
        <code>knowledge.search</code> and <code>knowledge.fetch</code> at session start.
      </div>

      {chainStep !== null && (
        <div
          className="border border-matrix-green bg-black/40 px-3 py-2 mb-3 font-mono text-xs text-matrix-body"
          role="status"
          aria-live="polite"
        >
          // mcp wiring:{" "}
          {chainStep === "config" && "saving bundle config…"}
          {chainStep === "wiring" && "writing AI client MCP configs…"}
          {chainStep === "install" && (
            <>
              dispatching <code>smith agent install {agent}</code>…
            </>
          )}
        </div>
      )}

      {chainError && chainStep === null && (
        <div className="font-mono text-[10px] text-matrix-red mb-3" role="alert" aria-live="polite">
          // mcp wiring: {chainError}
        </div>
      )}

      {!consentGranted && needsConsent && (
        <RefreshConsentBanner
          agent={agent}
          onAuthorizeAndRefresh={() => {
            // Persist the consent manifest synchronously, then dispatch
            // knowledge.fetch. Previously this only dispatched the fetch
            // — the CLI's interactive prompt doesn't fire under
            // spawn-from-GUI, so the manifest was never written and the
            // banner persisted forever after every "authorize" click.
            grantConsent.mutate(
              { platforms: ["opencode", "claude-code", "codex", "kiro"], sources: [] },
              {
                onSuccess: () => {
                  start.mutate({ command: "knowledge.fetch", agent });
                },
              },
            );
          }}
        />
      )}

      {empty ? (
        <div className="font-mono text-sm text-matrix-body py-6">
          // no knowledge sources yet. add one to give `{agent}` durable context.
        </div>
      ) : (
        <ul className="divide-y divide-matrix-line">
          {sources.map((joined) => (
            <li key={joined.source.id}>
              <KnowledgeSourceRow
                agent={agent}
                source={joined.source}
                refreshCache={joined.refreshCache}
                onRefresh={() =>
                  start.mutate({
                    command: "knowledge.fetch",
                    agent,
                    source: joined.source.id,
                  })
                }
                onRemove={() => setPendingRemove(joined.source)}
                onEdit={() => setEditing(joined.source)}
              />
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <AddKnowledgeSourceModal
          agent={agent}
          existingIds={sources.map((s) => s.source.id)}
          onClose={() => setAddOpen(false)}
        />
      )}

      {editing && (
        <EditKnowledgeSourceModal
          agent={agent}
          existingSource={editing}
          knowledgeBlock={
            ((detail.data?.config as Record<string, unknown> | undefined)?.knowledge as
              | { sources?: KnowledgeSource[] }
              | undefined) ?? { sources: sources.map((s) => s.source) }
          }
          onClose={() => setEditing(null)}
        />
      )}

      {pendingRemove && (
        <TypedTokenModal
          title={`Remove knowledge source "${pendingRemove.id}"`}
          expectedToken={pendingRemove.id}
          body={
            <>
              Removes <code>{pendingRemove.id}</code> from <code>{agent}</code>&rsquo;s knowledge
              manifest. Cached files on disk are not deleted by this command.
            </>
          }
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            start.mutate({
              command: "knowledge.remove",
              agent,
              sourceId: pendingRemove.id,
            });
            setPendingRemove(null);
          }}
        />
      )}

      {pendingFlip && chainStep === null && (
        <McpWiringModal
          agent={agent}
          enable={pendingFlip.enable}
          onCancel={cancelFlip}
          onConfirm={(platforms) => {
            void applyMcpWiring(pendingFlip.enable, platforms);
          }}
        />
      )}

      {refreshAllConfirm && (
        <TypedTokenModal
          title={`Refresh all knowledge for "${agent}"`}
          expectedToken={agent}
          body={
            <>
              Refreshes every source. May execute network requests, git fetches, and local file
              reads under the agent&rsquo;s permissions.
            </>
          }
          onCancel={() => setRefreshAllConfirm(false)}
          onConfirm={() => {
            start.mutate({ command: "knowledge.fetch", agent });
            setRefreshAllConfirm(false);
          }}
        />
      )}
    </Section>
  );
}

function Section({
  title,
  headerActions,
  children,
}: {
  title: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // knowledge sources for {title}
        </div>
        {headerActions}
      </div>
      {children}
    </Card>
  );
}
