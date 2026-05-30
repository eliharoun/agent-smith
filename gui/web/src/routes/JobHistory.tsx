import { useState } from "react";
import { JobHistoryTable, JobOutputDrawer, JobSearchBar } from "@/panels/JobHistory";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function JobHistory() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ScreenShell chrome={<Chrome title="History" subtitle="completed jobs + log search" />}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
        <div className="min-w-0">
          <JobHistoryTable onSelect={setSelected} />
        </div>
        <div>
          <JobSearchBar onJump={setSelected} />
        </div>
      </div>
      {selected && <JobOutputDrawer jobId={selected} onClose={() => setSelected(null)} />}
    </ScreenShell>
  );
}
