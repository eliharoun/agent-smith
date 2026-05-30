import { Link } from "react-router-dom";
import { KnowledgeIndex } from "@/panels/KnowledgeIndex";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function Knowledge() {
  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Knowledge"
          subtitle="// durable context for your agents"
          actions={
            <Link to="/knowledge/refresh-history">
              <Button variant="ghost">refresh history →</Button>
            </Link>
          }
        />
      }
    >
      <KnowledgeIndex />
    </ScreenShell>
  );
}
