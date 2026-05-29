import { RefreshHistoryIndex as RefreshHistoryIndexPanel } from "@/panels/RefreshHistory";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function RefreshHistoryIndex() {
  return (
    <ScreenShell
      chrome={
        <Chrome title="Refresh History" subtitle="// pick an agent to view its cache provenance" />
      }
    >
      <RefreshHistoryIndexPanel />
    </ScreenShell>
  );
}
