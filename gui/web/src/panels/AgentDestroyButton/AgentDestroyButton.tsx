import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStartJob } from "@/hooks/useStartJob";
import { AgentDestroyModal } from "@/panels/AgentDestroyModal";
import { Button } from "@/ui/Button";

/**
 * Entry-point button for destroying an agent. Opens the richer
 * `AgentDestroyModal` (which surfaces installed-target list + orphan-file
 * rationale and gates on a typed token) and forwards the resulting job to
 * `useStartJob`. Dispatches with `force: true` so the CLI chains
 * uninstall+destroy in the correct order under the `agent:<name>` lock —
 * see `AgentDestroyModal.tsx` and `src/cli/commands/destroy-agent.ts` for
 * rationale.
 */
export function AgentDestroyButton({
  name,
  protected: isProtected,
}: {
  name: string;
  /** When true (system bundle like agent-smith), the destroy control is not
   *  offered at all — hidden, not disabled, so the UI doesn't tease an action
   *  the server would refuse with 403. */
  protected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const start = useStartJob();
  const nav = useNavigate();
  if (isProtected) return null;
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Destroy
      </Button>
      <AgentDestroyModal
        agentName={name}
        open={open}
        onClose={() => setOpen(false)}
        onDispatch={async (job) => {
          setOpen(false);
          await start.mutateAsync(job);
          nav("/agents");
        }}
      />
    </>
  );
}
