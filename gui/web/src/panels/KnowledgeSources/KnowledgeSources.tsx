import type { KnowledgeSource } from "gui-shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { useGrantRefreshConsent, useKnowledge } from "@/hooks/useKnowledge";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { TypedTokenModal } from "@/ui/TypedTokenModal";
import { AddKnowledgeSourceModal } from "./AddKnowledgeSourceModal";
import { KnowledgeSourceRow } from "./KnowledgeSourceRow";
import { RefreshConsentBanner } from "./RefreshConsentBanner";

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
  const start = useStartJob();
  const grantConsent = useGrantRefreshConsent(agent);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<KnowledgeSource | null>(null);
  const [refreshAllConfirm, setRefreshAllConfirm] = useState(false);

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

  return (
    <Section
      title={agent}
      headerActions={
        <div className="flex gap-2">
          {/*
           * T11: progressive-compile + MCP serve buttons. Both are
           * intentionally disabled when there are zero sources — there's
           * nothing to index/serve. The CLI separately enforces that the
           * bundle has `knowledge.compile.progressive: true` set in
           * agent.config.json (exit 2 with a friendly suggestedCommand
           * otherwise), so we don't gate on that client-side: a no-op
           * payload still produces a useful error in the job log.
           */}
          <Button
            variant="ghost"
            disabled={empty}
            onClick={() => start.mutate({ command: "knowledge.compile", name: agent })}
          >
            compile
          </Button>
          <Button
            variant="ghost"
            disabled={empty}
            onClick={() => start.mutate({ command: "knowledge.serve", name: agent })}
          >
            serve
          </Button>
          <Button variant="ghost" disabled={empty} onClick={() => setRefreshAllConfirm(true)}>
            refresh all
          </Button>
          <Button onClick={() => setAddOpen(true)}>+ add source</Button>
        </div>
      }
    >
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
