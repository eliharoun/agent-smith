import { AgentCreateWizard } from "@/panels/AgentCreateWizard";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function AgentNew() {
  return (
    <ScreenShell chrome={<Chrome title="New Agent" subtitle="scaffold a bundle" />}>
      <AgentCreateWizard />
    </ScreenShell>
  );
}
