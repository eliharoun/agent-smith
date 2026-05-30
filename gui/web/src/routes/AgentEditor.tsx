import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAgent, useInstalledStatus } from "@/hooks/useAgents";
import { deriveRemotePathWeb } from "@/lib/remote-path";
import { REMOTE_ROOT_DISPLAY } from "@/lib/remote-root-display";
import { AgentDestroyButton } from "@/panels/AgentDestroyButton";
import { AgentEditorTabs } from "@/panels/AgentEditorTabs";
import { AgentPermissionsView } from "@/panels/AgentPermissionsView";
import { AgentPersonaEditor } from "@/panels/AgentPersonaEditor";
import { AgentSkillsView } from "@/panels/AgentSkillsView";
import { AgentTargetsForm } from "@/panels/AgentTargetsForm";
import { KnowledgeSources } from "@/panels/KnowledgeSources";
import { RemoteSyncConfirm } from "@/panels/RemoteSyncConfirm";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

// Render an inline notice when at least one platform shows the agent as
// installed. Bundle edits land in the catalog directory (the source) but the
// CLI's installer copies/links from there to per-platform locations at install
// time; without re-installing, edits don't reach already-deployed copies.
function InstalledNotice({ name }: { name: string }) {
  const q = useInstalledStatus(name);
  const installed = q.data?.installed ?? {};
  const anyInstalled = Object.values(installed).some(Boolean);
  if (!anyInstalled) return null;
  return (
    <div
      role="status"
      className="mb-3 border border-matrix-amber px-3 py-2 font-mono text-xs text-matrix-amber"
    >
      // notice: this agent is installed on at least one platform. Edits to this bundle won't
      propagate until you re-install the agent.
    </div>
  );
}

// Safe clone-dir derivation for the sync-confirm modal: if the daemon ever
// returns a `remote.url` that the web-side parser can't normalize (it
// shouldn't, but defense-in-depth), fall back to the bare URL so the modal
// still opens with a meaningful display value rather than crashing.
function safeCloneDir(url: string): string {
  try {
    return deriveRemotePathWeb(url, REMOTE_ROOT_DISPLAY);
  } catch {
    return url;
  }
}

export function AgentEditor() {
  const { name = "" } = useParams();
  const q = useAgent(name);
  const [syncOpen, setSyncOpen] = useState(false);
  if (q.isLoading)
    return (
      <ScreenShell>
        <div>loading…</div>
      </ScreenShell>
    );
  if (!q.data)
    return (
      <ScreenShell>
        <div>agent not found</div>
      </ScreenShell>
    );
  const a = q.data;
  const remote = a.remote;
  // Behind = we know what the remote points at AND it diverges from what we
  // last pulled. Absent `lastRemoteSha` means we haven't probed yet — treat
  // as "in sync" rather than "update available" to avoid false-positive
  // amber. Same heuristic as RemoteBadge / AgentList for consistency.
  const behind =
    !!remote && remote.lastRemoteSha !== undefined && remote.lastRemoteSha !== remote.lastPulledSha;

  return (
    <ScreenShell
      chrome={
        <Chrome
          title={a.name}
          subtitle={a.description}
          actions={
            <>
              {remote &&
                (behind ? (
                  <span className="font-mono text-xs text-matrix-amber uppercase tracking-wider self-center">
                    ↑ update available
                  </span>
                ) : (
                  <span className="font-mono text-xs text-matrix-green-muted uppercase tracking-wider self-center">
                    ↻ synced
                  </span>
                ))}
              {remote && (
                <Button variant="ghost" disabled={!behind} onClick={() => setSyncOpen(true)}>
                  {behind ? "Sync now" : "Up to date"}
                </Button>
              )}
              <AgentDestroyButton name={a.name} />
            </>
          }
        />
      }
    >
      <InstalledNotice name={a.name} />
      <AgentEditorTabs
        tabs={[
          {
            id: "identity",
            label: "Identity",
            element: (
              <AgentPersonaEditor
                key={`identity:${a.identity}`}
                name={a.name}
                file="IDENTITY"
                title="IDENTITY.md"
                content={a.identity}
              />
            ),
          },
          {
            id: "expertise",
            label: "Expertise",
            element: (
              <AgentPersonaEditor
                key={`expertise:${a.expertise}`}
                name={a.name}
                file="EXPERTISE"
                title="EXPERTISE.md"
                content={a.expertise}
              />
            ),
          },
          {
            id: "soul",
            label: "Soul",
            element: (
              <AgentPersonaEditor
                key={`soul:${a.soul}`}
                name={a.name}
                file="SOUL"
                title="SOUL.md"
                content={a.soul}
              />
            ),
          },
          {
            id: "user",
            label: "User",
            element: (
              <AgentPersonaEditor
                key={`user:${a.user}`}
                name={a.name}
                file="USER"
                title="USER.md"
                content={a.user}
              />
            ),
          },
          { id: "targets", label: "Targets · Model", element: <AgentTargetsForm agent={a} /> },
          {
            id: "knowledge",
            label: "Knowledge",
            element: <KnowledgeSources agent={a.name} />,
          },
          {
            id: "permissions",
            label: "Permissions",
            element: <AgentPermissionsView agentName={a.name} />,
          },
          { id: "skills", label: "Skills", element: <AgentSkillsView agentName={a.name} /> },
        ]}
      />
      {remote && (
        <RemoteSyncConfirm
          kind="agent"
          name={a.name}
          url={remote.url}
          gitRef={remote.ref ?? null}
          cloneDir={safeCloneDir(remote.url)}
          open={syncOpen}
          onClose={() => setSyncOpen(false)}
        />
      )}
    </ScreenShell>
  );
}
