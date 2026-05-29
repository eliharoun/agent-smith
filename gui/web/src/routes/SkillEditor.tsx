import { useState } from "react";
import { useParams } from "react-router-dom";
import { useSkill } from "@/hooks/useSkill";
import { deriveRemotePathWeb } from "@/lib/remote-path";
import { REMOTE_ROOT_DISPLAY } from "@/lib/remote-root-display";
import { RemoteSyncConfirm } from "@/panels/RemoteSyncConfirm";
import { SkillBodyEditor } from "@/panels/SkillBodyEditor";
import { SkillEditorTabs } from "@/panels/SkillEditorTabs";
import { SkillFrontmatterForm } from "@/panels/SkillFrontmatterForm";
import { SkillInstallMatrix } from "@/panels/SkillInstallMatrix";
import { SkillResourcesTree } from "@/panels/SkillResourcesTree";
import { SkillValidate } from "@/panels/SkillValidate";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

// Same defense-in-depth fallback as AgentEditor: a malformed `remote.url`
// from the daemon (shouldn't happen, but) must not crash the modal open.
function safeCloneDir(url: string): string {
  try {
    return deriveRemotePathWeb(url, REMOTE_ROOT_DISPLAY);
  } catch {
    return url;
  }
}

export function SkillEditor() {
  const { name = "" } = useParams();
  const q = useSkill(name);
  const [syncOpen, setSyncOpen] = useState(false);

  if (q.isLoading) {
    return (
      <ScreenShell>
        <div className="font-mono text-sm text-matrix-body">loading…</div>
      </ScreenShell>
    );
  }
  // Treat any error (404 included) as "not found"; the API returns 404 with
  // code=NOT_FOUND when the skill is missing from every registered catalog.
  if (q.error || !q.data) {
    return (
      <ScreenShell chrome={<Chrome title={name} subtitle="skill not found" />}>
        <div className="font-mono text-sm text-matrix-amber">
          // no skill named "{name}" found in any registered catalog
        </div>
      </ScreenShell>
    );
  }

  const s = q.data;
  const remote = s.remote;
  // Mirror of AgentEditor (C4.9.1): only flag drift when we have observed
  // both pulled and remote SHAs and they diverge. Unknown remote SHA =
  // "not yet probed", which is reported as in-sync to avoid false amber.
  const behind =
    !!remote && remote.lastRemoteSha !== undefined && remote.lastRemoteSha !== remote.lastPulledSha;

  return (
    <ScreenShell
      chrome={
        <Chrome
          title={s.name}
          subtitle={s.frontmatter.description ?? s.catalogLabel}
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
              <SkillValidate name={s.name} />
            </>
          }
        />
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
        <div className="min-w-0">
          <SkillEditorTabs
            tabs={[
              {
                id: "frontmatter",
                label: "Frontmatter",
                element: <SkillFrontmatterForm frontmatter={s.frontmatter} />,
              },
              { id: "body", label: "Body", element: <SkillBodyEditor body={s.body} /> },
              {
                id: "resources",
                label: "Resources",
                element: <SkillResourcesTree resources={s.resources} />,
              },
            ]}
          />
        </div>
        <div>
          <SkillInstallMatrix name={s.name} installedOn={s.installedOn} />
        </div>
      </div>
      {remote && (
        <RemoteSyncConfirm
          kind="skill"
          name={s.name}
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
