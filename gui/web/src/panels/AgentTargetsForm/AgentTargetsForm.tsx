import type { AgentDetail, ModelTier, Platform, Target } from "gui-shared";
import { useEffect, useMemo, useState } from "react";
import { useSaveAgentConfig } from "@/hooks/useAgents";
import { useDriftCheck } from "@/hooks/useDriftCheck";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { useKnowledge } from "@/hooks/useKnowledge";
import { useRefreshManifest } from "@/hooks/useRefreshManifest";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { FieldHelp } from "@/ui/FieldHelp";
import { ProtectedBadge } from "@/ui/ProtectedBadge";
import { Tooltip } from "@/ui/Tooltip";

const ALL_TARGETS: Target[] = ["opencode", "claude-code", "codex", "kiro", "agents-md"];

// Targets that have a runtime CLI / refresh hook / installed-status. Excludes
// agents-md, which is an emit-only render target with no runtime.
const PLATFORM_TARGETS = new Set<Target>(["opencode", "claude-code", "codex", "kiro"]);
const isPlatform = (t: Target): t is Platform => PLATFORM_TARGETS.has(t);
const MODEL_TIERS: ModelTier[] = ["high", "balanced", "fast", "inherit"];
const TIER_LABEL: Record<ModelTier, string> = {
  high: "high — most capable (opus-class)",
  balanced: "balanced — default (sonnet-class)",
  fast: "fast — cheapest / fastest (haiku-class)",
  inherit: "inherit — use platform default",
};
const TIER_ALIASES: Record<string, ModelTier> = { opus: "high", sonnet: "balanced", haiku: "fast" };

function normalizeTier(raw: unknown): ModelTier {
  const s = typeof raw === "string" ? raw : "inherit";
  if ((MODEL_TIERS as string[]).includes(s)) return s as ModelTier;
  return TIER_ALIASES[s] ?? "inherit";
}

// Read-only targets/tier view for system bundles (agent-smith). No editable
// controls — the server 403s the config PUT, so we don't tease the action.
// Split into its own component so the editable form below can use hooks
// unconditionally (rules-of-hooks).
function ProtectedTargetsView({ agent }: { agent: AgentDetail }) {
  const tier = normalizeTier((agent.config as Record<string, unknown>).modelTier);
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <FieldHelp fieldId="agent.targets">targets</FieldHelp>
        <ProtectedBadge />
      </div>
      <div className="space-y-1 mb-4 font-mono text-sm text-matrix-body">
        {[...agent.targets].sort().map((p) => (
          <div key={p}>• {p}</div>
        ))}
      </div>
      <div className="mb-1 font-mono text-sm text-matrix-body">model tier: {tier}</div>
      <p className="font-mono text-[10px] text-matrix-amber mt-3">
        // this is a system bundle managed by smith — read-only. Refresh with{" "}
        <code>smith update</code>.
      </p>
    </Card>
  );
}

export function AgentTargetsForm({ agent }: { agent: AgentDetail }) {
  if (agent.protected) return <ProtectedTargetsView agent={agent} />;
  return <EditableTargetsForm agent={agent} />;
}

function EditableTargetsForm({ agent }: { agent: AgentDetail }) {
  const savedTargets = useMemo(() => [...agent.targets].sort(), [agent.targets]);
  const savedTier = normalizeTier((agent.config as Record<string, unknown>).modelTier);

  const [targets, setTargets] = useState<Set<Target>>(new Set(agent.targets));
  const [tier, setTier] = useState<ModelTier>(savedTier);
  const [reconcile, setReconcile] = useState<{
    added: Target[];
    removed: Target[];
    modelChanged: boolean;
  } | null>(null);

  // Reseed local state when the saved baseline changes (after a save → refetch).
  useEffect(() => {
    setTargets(new Set(agent.targets));
    setTier(normalizeTier((agent.config as Record<string, unknown>).modelTier));
  }, [agent.targets, agent.config]);

  const save = useSaveAgentConfig(agent.name);
  const statuses = useInstalledStatuses();
  const installed = statuses.data?.[agent.name]?.installed ?? {};
  const driftCheck = useDriftCheck(agent.name);
  const driftSet = useMemo(
    () => new Set<Platform>(driftCheck.drifted ?? []),
    [driftCheck.drifted],
  );

  const draftTargets = useMemo(() => [...targets].sort(), [targets]);
  const targetsDirty = draftTargets.join(",") !== savedTargets.join(",");
  const tierDirty = tier !== savedTier;
  const dirty = targetsDirty || tierDirty;
  const noTargets = targets.size === 0;

  function toggleTarget(p: Target, on: boolean) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  function handleSave() {
    if (noTargets || !dirty) return;
    const patch: { targets?: Target[]; modelTier?: ModelTier } = {};
    if (targetsDirty) patch.targets = [...targets];
    if (tierDirty) patch.modelTier = tier;
    const added = [...targets].filter((p) => !savedTargets.includes(p));
    const removed = (savedTargets as Target[]).filter((p) => !targets.has(p));
    save.mutate(patch, {
      onSuccess: () => setReconcile({ added, removed, modelChanged: tierDirty }),
    });
  }

  function handleRevert() {
    setTargets(new Set(agent.targets));
    setTier(savedTier);
    setReconcile(null);
  }

  return (
    <Card>
      <div className="mb-2">
        <FieldHelp fieldId="agent.targets">targets</FieldHelp>
      </div>
      <div className="space-y-1 mb-4">
        {ALL_TARGETS.map((p) => {
          const drifted = isPlatform(p) && installed[p] && driftSet.has(p);
          return (
            <label key={p} className="flex items-center gap-2 font-mono text-sm text-matrix-body">
              <input
                type="checkbox"
                checked={targets.has(p)}
                onChange={(e) => toggleTarget(p, e.target.checked)}
                aria-label={p}
              />
              <span>{p}</span>
              <span className="text-[10px] text-matrix-green-muted">
                {!isPlatform(p)
                  ? "• emit-only"
                  : installed[p]
                    ? "• installed"
                    : "• not installed"}
              </span>
              {drifted && (
                <Tooltip content="out of date — re-install needed">
                  <span
                    data-testid={`drift-dot-${p}`}
                    aria-label={`${p} is out of date — re-install needed`}
                    tabIndex={0}
                    className="inline-block w-2 h-2 rounded-full bg-matrix-green shadow-[0_0_6px_rgba(26,255,140,0.7)] cursor-help"
                  />
                </Tooltip>
              )}
            </label>
          );
        })}
      </div>

      <div className="mb-2">
        <FieldHelp fieldId="agent.modelTier" htmlFor="agent-model-tier">
          model tier
        </FieldHelp>
      </div>
      <select
        id="agent-model-tier"
        aria-label="model tier"
        className="bg-matrix-bg border border-matrix-line text-matrix-body font-mono text-sm p-1 mb-1 w-full max-w-sm"
        value={tier}
        onChange={(e) => setTier(e.target.value as ModelTier)}
      >
        {MODEL_TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL[t]}
          </option>
        ))}
      </select>
      <div className="text-[11px] text-matrix-green-muted mb-4">
        Resolves per platform. Changing it needs a re-install to apply.
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={!dirty || noTargets || save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={handleRevert}>
            Revert
          </Button>
        )}
        {noTargets && (
          <span className="font-mono text-[11px] text-matrix-amber">
            at least one target required
          </span>
        )}
      </div>
      {save.isError && (
        <div className="font-mono text-[10px] text-matrix-red mt-2">
          // error: {save.error instanceof Error ? save.error.message : String(save.error)}
        </div>
      )}

      {reconcile && (
        <ReconcileNudges
          agent={agent.name}
          reconcile={reconcile}
          installed={installed}
          savedTargets={agent.targets}
        />
      )}

      <div className="mt-6 border-t border-matrix-line pt-4">
        <RefreshHooksSection agent={agent.name} targets={agent.targets} />
      </div>
    </Card>
  );
}

function ReconcileNudges({
  agent,
  reconcile,
  installed,
  savedTargets,
}: {
  agent: string;
  reconcile: { added: Target[]; removed: Target[]; modelChanged: boolean };
  installed: Partial<Record<Platform, boolean>>;
  savedTargets: Target[];
}) {
  const start = useStartJob();
  // installed-status / install / uninstall jobs only operate on Platform
  // (agents-md has no runtime CLI). Filter agents-md out before each.
  const installedTargets = savedTargets.filter(isPlatform).filter((p) => installed[p]);
  const showModel = reconcile.modelChanged && installedTargets.length > 0;
  const addedPlatforms = reconcile.added.filter(isPlatform);
  const removedInstalled = reconcile.removed.filter(isPlatform).filter((p) => installed[p]);
  if (!showModel && addedPlatforms.length === 0 && removedInstalled.length === 0) return null;
  return (
    <div className="mt-3 border-l-2 border-matrix-amber pl-3 space-y-2">
      {showModel && (
        <div className="font-mono text-[11px] text-matrix-amber">
          Model change needs re-install to apply.{" "}
          <Button
            variant="ghost"
            onClick={() =>
              start.mutate({
                command: "agent.install",
                name: agent,
                platforms: installedTargets,
                withSkills: false,
              })
            }
          >
            Re-install now ({installedTargets.join(", ")})
          </Button>
        </div>
      )}
      {addedPlatforms.map((p) => (
        <div key={`add-${p}`} className="font-mono text-[11px] text-matrix-amber">
          {p} added — not deployed yet.{" "}
          <Button
            variant="ghost"
            onClick={() =>
              start.mutate({
                command: "agent.install",
                name: agent,
                platforms: [p],
                withSkills: false,
              })
            }
          >
            Install on {p} now
          </Button>
        </div>
      ))}
      {removedInstalled.map((p) => (
        <div key={`rm-${p}`} className="font-mono text-[11px] text-matrix-red">
          {p} removed but still installed.{" "}
          <Button
            variant="ghost"
            onClick={() =>
              start.mutate({ command: "agent.uninstall", name: agent, platforms: [p] })
            }
          >
            Uninstall from {p}
          </Button>
        </div>
      ))}
    </div>
  );
}

const NETWORK_TYPES = new Set(["url", "git", "confluence", "jira"]);
const REFRESH_MODES = new Set(["session", "always"]);

function RefreshHooksSection({ agent, targets }: { agent: string; targets: Target[] }) {
  const knowledge = useKnowledge(agent);
  const manifest = useRefreshManifest(agent);
  const statuses = useInstalledStatuses();
  const start = useStartJob();
  const [desired, setDesired] = useState<Partial<Record<Platform, boolean>> | null>(null);

  // Refresh hooks are a runtime concern — agents-md has no runtime, so
  // we drop it from the consent UI entirely.
  const platformTargets = useMemo(() => targets.filter(isPlatform), [targets]);

  useEffect(() => {
    if (!manifest.data || desired !== null) return;
    const granted = new Set(manifest.data.platforms);
    const seed: Partial<Record<Platform, boolean>> = {};
    for (const p of platformTargets) seed[p] = granted.has(p);
    setDesired(seed);
  }, [manifest.data, desired, platformTargets]);

  const header = (
    <div className="mb-2">
      <FieldHelp fieldId="agent.refreshHooksPerPlatform">refresh hooks</FieldHelp>
    </div>
  );

  const sources = knowledge.data?.sources ?? [];
  const needsConsent = sources.some(
    (j: { source: { type: string; refresh?: unknown } }) =>
      NETWORK_TYPES.has(j.source.type) ||
      (j.source.refresh != null && REFRESH_MODES.has(String(j.source.refresh))),
  );

  if (knowledge.isLoading) {
    return (
      <>
        {header}
        <p className="font-mono text-xs text-matrix-green-muted">// loading…</p>
      </>
    );
  }
  if (!needsConsent) {
    return (
      <>
        {header}
        <p className="font-mono text-xs text-matrix-green-muted">
          This agent has no auto-refreshing knowledge sources, so refresh hooks have no effect. Add
          a url, git, or session-refresh source in the Knowledge tab to enable this.
        </p>
      </>
    );
  }
  if (!manifest.data || desired === null) {
    return (
      <>
        {header}
        <p className="font-mono text-xs text-matrix-green-muted">// loading…</p>
      </>
    );
  }

  const currentGranted = new Set(manifest.data.platforms);
  const installed = statuses.data?.[agent]?.installed ?? {};

  function handleSave() {
    const grant: Platform[] = [];
    const revoke: Platform[] = [];
    for (const p of platformTargets) {
      const want = desired![p] ?? false;
      const have = currentGranted.has(p);
      if (want && !have) grant.push(p);
      if (!want && have) revoke.push(p);
    }
    if (grant.length === 0 && revoke.length === 0) return;
    start.mutate({ command: "agent.reconfigure", name: agent, grant, revoke });
  }

  return (
    <>
      {header}
      <p className="text-matrix-body text-xs mb-3">
        Re-pull this agent's knowledge sources inside each platform. Choose per platform.
      </p>
      <div className="space-y-2 mb-3">
        {platformTargets.map((p) => {
          const canToggle = installed[p] === true || currentGranted.has(p);
          return (
            <label key={p} className="flex items-center gap-2 font-mono text-sm text-matrix-body">
              <input
                type="checkbox"
                checked={desired[p] ?? false}
                disabled={!canToggle}
                title={canToggle ? undefined : `Install on ${p} to enable refresh-hook consent.`}
                onChange={(e) => setDesired({ ...desired, [p]: e.target.checked })}
                aria-label={`refresh ${p}`}
              />
              <span>{p}</span>
              {!canToggle && (
                <span className="text-[10px] text-matrix-green-muted">— not installed</span>
              )}
            </label>
          );
        })}
      </div>
      {start.isError && (
        <div className="font-mono text-[10px] text-matrix-red mb-2">
          // error: {start.error instanceof Error ? start.error.message : String(start.error)}
        </div>
      )}
      <Button onClick={handleSave} disabled={start.isPending}>
        {start.isPending ? "Saving…" : "Save refresh hooks"}
      </Button>
    </>
  );
}
