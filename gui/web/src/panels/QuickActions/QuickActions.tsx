import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

export function QuickActions() {
  const navigate = useNavigate();
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // quick actions
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("/agents?add=true")}>+ Add agent</Button>
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
