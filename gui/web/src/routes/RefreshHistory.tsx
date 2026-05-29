import { Navigate, useParams } from "react-router-dom";
import { RefreshHistory as RefreshHistoryPanel } from "@/panels/RefreshHistory";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function RefreshHistory() {
  const { agent } = useParams<{ agent: string }>();
  if (!agent) return <Navigate to="/knowledge/refresh-history" replace />;
  return (
    <ScreenShell
      chrome={
        <Chrome title="Refresh History" subtitle={`${agent} — per-source cache provenance`} />
      }
    >
      <RefreshHistoryPanel agent={agent} />
    </ScreenShell>
  );
}
