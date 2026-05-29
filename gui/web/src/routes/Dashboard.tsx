import { QuickActions } from "@/panels/QuickActions";
import { RecentActivity } from "@/panels/RecentActivity";
import { StatStrip } from "@/panels/StatStrip";
import { TerminalStrip } from "@/panels/TerminalStrip";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function Dashboard() {
  return (
    <ScreenShell chrome={<Chrome title="Dashboard" subtitle="construct overview" />}>
      <StatStrip />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <QuickActions />
        <RecentActivity />
      </div>
      <TerminalStrip />
    </ScreenShell>
  );
}
