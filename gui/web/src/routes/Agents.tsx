import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { JobRequest } from "gui-shared";
import { AgentList } from "@/panels/AgentList";
import { AddAgentModal } from "@/panels/AddAgentModal/AddAgentModal";
import {
  InstallJobWatcher,
  useInstallCompletionWatcher,
} from "@/hooks/useInstallCompletionWatcher";
import { useJobToast } from "@/hooks/useJobToast";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

type AddView = "menu" | "template" | "install" | "register";

export function AgentsList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [initialView, setInitialView] = useState<AddView>("menu");

  const { installJobIds, maybeFire } = useInstallCompletionWatcher();

  const installAgentToast = useJobToast({
    command: "agent.install",
    label: {
      progress: () => "Installing agent…",
      success: () => "Agent installed",
      error: () => "Install failed",
    },
    dedupKey: "job-toast:agent.install",
  });

  const initAgentToast = useJobToast({
    command: "agent.init",
    label: {
      progress: () => "Creating agent…",
      success: () => "Agent created",
      error: () => "Create failed",
    },
    dedupKey: "job-toast:agent.init",
  });

  const registerAgentToast = useJobToast({
    command: "agent.register",
    label: {
      progress: () => "Registering catalog…",
      success: () => "Catalog registered",
      error: () => "Register failed",
    },
    dedupKey: "job-toast:agent.register",
  });

  // Deep-link: ?add=true|create → menu, ?add=install → install, ?add=register → register
  useEffect(() => {
    const add = searchParams.get("add");
    if (!add) return;
    if (add === "install") {
      setInitialView("install");
    } else if (add === "register") {
      setInitialView("register");
    } else {
      setInitialView("menu");
    }
    setAddOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDispatch(req: JobRequest) {
    const cmd = (req as { command?: string }).command ?? "";
    if (cmd === "agent.install") {
      installAgentToast.dispatch(req);
    } else if (cmd === "agent.init") {
      initAgentToast.dispatch(req);
    } else if (cmd === "agent.register" || cmd === "skill.register") {
      registerAgentToast.dispatch(req);
    }
  }

  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Agents"
          subtitle="construct registry"
          actions={
            <div className="flex gap-2">
              <Button onClick={() => { setInitialView("menu"); setAddOpen(true); }}>
                + Add agent
              </Button>
              <Link to="/agents/install-matrix">
                <Button variant="ghost">Manage installs</Button>
              </Link>
            </div>
          }
        />
      }
    >
      <AgentList />
      <AddAgentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDispatch={handleDispatch}
        initialView={initialView}
        onAgentCreated={(name) => {
          setAddOpen(false);
          navigate("/agents/" + encodeURIComponent(name));
        }}
      />
      {/* One watcher per active agent.install job — fires sync-hint toast when
          the job exits 0 and its stdout contained a dir-install envelope. */}
      {installJobIds.map((id) => (
        <InstallJobWatcher key={id} jobId={id} maybeFire={maybeFire} />
      ))}
    </ScreenShell>
  );
}
