import type { KnowledgeSource } from "gui-shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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

  // MCP wiring toggle state (Task v2.1-D).
  // The toggle reflects whether the bundle's `mcpServers: string[]` array
  // contains "agent-smith-knowledge": present → ON, absent → OFF. We read
  // from the agent detail (which the panel already fetches for the
  // per-source editor); on flip we PUT the full deduplicated array
  // (existing entries + the toggle outcome) so intentional removals
  // propagate.
  const config = detail.data?.config as Record<string, unknown> | undefined;
  const mcpServers = readMcpServers(config);
  const savedOn = mcpServers.includes(MCP_SERVER_KEY);
  // Optimistic flag for in-flight flip — the switch animates instantly,
  // and we revert on PUT failure. Cleared when the refetched config
  // catches up (so the toggle reflects ground truth after save).
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (optimisticOn !== null && optimisticOn === savedOn) setOptimisticOn(null);
  }, [optimisticOn, savedOn]);
  const mcpOn = optimisticOn ?? savedOn;
  // Sticky install-reminder banner (Task v2.1-D). Shown after the user
  // flips the toggle (the panel can't run `smith agent install` itself —
  // that's a heavy operation gated behind the existing install UI). Stays
  // visible until the user navigates away or dismisses it. The banner
  // copy depends on the direction of the flip: ON tells the user about
  // the second step (adding spawn config to their AI client's global MCP
  // config); OFF only mentions running install (leaving an unused server
  // entry in the AI-client config is harmless).
  const [installReminder, setInstallReminder] = useState<"on" | "off" | null>(null);

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

  function flipMcpToggle(next: boolean) {
    if (saveConfig.isPending) return;
    setOptimisticOn(next);
    // Build the deduplicated array: existing entries minus the canonical
    // name, plus the canonical name iff toggle is ON. Whole array is sent
    // (server replaces). Empty array is fine — the canonical schema
    // accepts an empty `mcpServers` because the field is optional.
    const without = mcpServers.filter((n) => n !== MCP_SERVER_KEY);
    const nextArray = next ? [...without, MCP_SERVER_KEY] : without;
    saveConfig.mutate(
      { mcpServers: nextArray },
      {
        onSuccess: () => {
          setInstallReminder(next ? "on" : "off");
        },
        onError: () => {
          // Revert optimistic flip; the banner stays hidden.
          setOptimisticOn(null);
        },
      },
    );
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
            disabled={saveConfig.isPending}
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

      {installReminder === "on" && (
        <div
          className="border border-matrix-green bg-black/40 px-3 py-2 mb-3 flex items-start justify-between gap-3"
          role="status"
        >
          <div className="font-mono text-xs text-matrix-body space-y-2">
            <div className="text-matrix-green">
              // knowledge mcp server enabled. two steps to finish wiring:
            </div>
            <div>
              1. run <code className="text-matrix-green">smith agent install {agent}</code> so the
              bundle is rebuilt.
            </div>
            <div>
              2. add the spawn config to your AI client&rsquo;s global MCP settings:
              <div className="mt-1 ml-3">
                <span className="text-matrix-green-muted">command:</span>{" "}
                <code className="text-matrix-green">smith</code>
                <br />
                <span className="text-matrix-green-muted">args:</span>{" "}
                <code className="text-matrix-green">knowledge serve {agent} --stdio</code>
              </div>
            </div>
            <div>where to add it (per platform):</div>
            <ul className="ml-3 space-y-1">
              <li>
                <span className="text-matrix-green-muted">- OpenCode:</span>{" "}
                <code>~/.config/opencode/opencode.json</code>{" "}
                <span className="text-matrix-green-muted">(top-level "mcp" key)</span>
              </li>
              <li>
                <span className="text-matrix-green-muted">- Claude Code:</span>{" "}
                <code>~/.claude.json</code>{" "}
                <span className="text-matrix-green-muted">(top-level "mcpServers" key)</span>
              </li>
              <li>
                <span className="text-matrix-green-muted">- Codex:</span>{" "}
                <code>~/.codex/config.toml</code>{" "}
                <span className="text-matrix-green-muted">
                  ([mcp_servers.agent-smith-knowledge])
                </span>
              </li>
            </ul>
          </div>
          <Button variant="ghost" onClick={() => setInstallReminder(null)}>
            dismiss
          </Button>
        </div>
      )}

      {installReminder === "off" && (
        <div
          className="border border-matrix-green bg-black/40 px-3 py-2 mb-3 flex items-center justify-between gap-3"
          role="status"
        >
          <div className="font-mono text-xs text-matrix-body">
            // knowledge mcp server disabled. run{" "}
            <code className="text-matrix-green">smith agent install {agent}</code> to apply.
          </div>
          <Button variant="ghost" onClick={() => setInstallReminder(null)}>
            dismiss
          </Button>
        </div>
      )}

      {saveConfig.isError && (
        <div className="font-mono text-[10px] text-matrix-red mb-3" role="alert" aria-live="polite">
          // mcp toggle save failed:{" "}
          {saveConfig.error instanceof Error ? saveConfig.error.message : String(saveConfig.error)}
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
