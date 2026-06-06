import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

// Quick actions are grouped by use-case so the Dashboard reads as
// "what do you want to work on" (agents / skills) rather than a flat
// list of unrelated verbs. System actions (diagnostics) sit last.
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function QuickActions() {
  const navigate = useNavigate();
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // quick actions
      </div>
      <div className="flex flex-col gap-4">
        <Group label="agents">
          <Button onClick={() => navigate("/agents?add=true")}>+ Add agent</Button>
          <Link to="/agents">
            <Button variant="ghost">Browse agents</Button>
          </Link>
          <Link to="/agents/install-matrix">
            <Button variant="ghost">Manage installs</Button>
          </Link>
        </Group>
        <Group label="skills">
          <Button onClick={() => navigate("/skills/new")}>+ Add skill</Button>
          <Link to="/skills">
            <Button variant="ghost">Browse skills</Button>
          </Link>
        </Group>
        <Group label="system">
          <Link to="/system/doctor">
            <Button variant="ghost">Run doctor</Button>
          </Link>
        </Group>
      </div>
    </Card>
  );
}
