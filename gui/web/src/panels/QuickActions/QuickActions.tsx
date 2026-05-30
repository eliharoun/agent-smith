import { Link } from "react-router-dom";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

export function QuickActions() {
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // quick actions
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/agents/new">
          <Button>+ New agent</Button>
        </Link>
        <Link to="/agents">
          <Button variant="ghost">Browse agents</Button>
        </Link>
        <Link to="/agents/install-matrix">
          <Button variant="ghost">Install matrix</Button>
        </Link>
        <Link to="/system/doctor">
          <Button variant="ghost">Run doctor</Button>
        </Link>
      </div>
    </Card>
  );
}
