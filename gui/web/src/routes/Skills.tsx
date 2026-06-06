import { useState } from "react";
import { Link } from "react-router-dom";
import { InstallExistingForm } from "@/panels/InstallExistingForm";
import { SkillBootstrap } from "@/panels/SkillBootstrap";
import { SkillCatalogList } from "@/panels/SkillCatalogList";
import { SkillList } from "@/panels/SkillList";
import { useJobToast } from "@/hooks/useJobToast";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

// InstallFromUrlButton (C4.8.3) — mirror of the Agents-route trigger; the
// pulse dot telegraphs the new external-install surface on the Skills page.
function InstallFromUrlButton({ onClick }: { onClick: () => void }) {
  return (
    <span className="relative inline-block">
      <span
        data-pulse-dot
        aria-hidden
        className="absolute -top-0.5 -left-0.5 w-[6px] h-[6px] bg-matrix-green shadow-matrix-glow animate-pulse"
      />
      <Button variant="ghost" onClick={onClick}>
        Install from URL
      </Button>
    </span>
  );
}

export function Skills() {
  const [installOpen, setInstallOpen] = useState(false);
  const installSkillToast = useJobToast({
    command: "skill.install",
    label: {
      progress: () => "Installing skill\u2026",
      success: () => "Skill installed",
      error: () => "Install failed",
    },
    dedupKey: "job-toast:skill.install",
  });

  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Skills"
          subtitle="reusable workflows for your agents"
          actions={
            <>
              <InstallFromUrlButton onClick={() => setInstallOpen(true)} />
              <Link to="/skills/new">
                <Button>+ Register</Button>
              </Link>
            </>
          }
        />
      }
    >
      <SkillList />
      <SkillBootstrap />
      <SkillCatalogList />
      <InstallExistingForm
        kind="skill"
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onDispatch={installSkillToast.dispatch}
      />
    </ScreenShell>
  );
}
