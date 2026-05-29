import type { JobRequest } from "gui-shared";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";

interface Props {
  kind: "agent" | "skill";
  name: string;
  url: string;
  /** Git ref (branch / tag / sha). Named `gitRef` (not `ref`) because React
   * intercepts the `ref` prop on intrinsic JSX elements. */
  gitRef: string | null;
  cloneDir: string;
  open: boolean;
  onClose: () => void;
}

/**
 * RemoteSyncConfirm (C4.6.1)
 *
 * Confirmation modal for the sync flow. Triggered from <RemoteBadge /> in
 * list rows (C4.7) and from the detail view's "Sync now" affordance (C4.8).
 *
 * Sync is destructive of local edits — the CLI does a hard fast-forward
 * against the remote ref and discards any uncommitted changes in the clone
 * directory. We surface that warning prominently before dispatch.
 */
export function RemoteSyncConfirm({ kind, name, url, gitRef, cloneDir, open, onClose }: Props) {
  const start = useStartJob();
  if (!open) return null;

  const onSync = () => {
    const req: JobRequest =
      kind === "agent" ? { command: "agent.sync", name } : { command: "skill.sync", name };
    start.mutate(req);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <div className="border border-matrix-green bg-black p-6 w-[32rem] font-mono">
        <h2 className="text-matrix-green text-sm uppercase tracking-widest mb-4 break-all">
          // sync {name} from {url}
        </h2>
        <p className="text-xs text-matrix-body mb-2 break-all">
          Pull updates from{" "}
          <code className="text-matrix-green">
            {url} @ {gitRef ?? "HEAD"}
          </code>
          ?
        </p>
        <p className="text-xs text-matrix-amber mb-4 break-all">
          This is destructive of any local edits in <code>{cloneDir}</code>. Smith does not preserve
          local changes; the clone is reset to match origin.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button onClick={onSync}>sync</Button>
        </div>
      </div>
    </div>
  );
}
