import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { JobRequest } from "gui-shared";
import { AddSkillModal } from "@/panels/AddSkillModal";
import { SkillBootstrap } from "@/panels/SkillBootstrap";
import { SkillCatalogList } from "@/panels/SkillCatalogList";
import { SkillList } from "@/panels/SkillList";
import { useJobToast } from "@/hooks/useJobToast";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

type AddView = "menu" | "install" | "register";

export function Skills() {
  const [searchParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [initialView, setInitialView] = useState<AddView>("menu");

  const installSkillToast = useJobToast({
    command: "skill.install",
    label: {
      progress: () => "Installing skill…",
      success: () => "Skill installed",
      error: () => "Install failed",
    },
    dedupKey: "job-toast:skill.install",
  });

  const registerSkillToast = useJobToast({
    command: "skill.register",
    label: {
      progress: () => "Registering catalog…",
      success: () => "Catalog registered",
      error: () => "Register failed",
    },
    dedupKey: "job-toast:skill.register",
  });

  // Deep-link: ?add=true → menu, ?add=install → install, ?add=register → register
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
    if (cmd === "skill.install") {
      installSkillToast.dispatch(req);
    } else if (cmd === "skill.register") {
      registerSkillToast.dispatch(req);
    }
  }

  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Skills"
          subtitle="reusable workflows for your agents"
          actions={
            <Button onClick={() => { setInitialView("menu"); setAddOpen(true); }}>
              + Add skill
            </Button>
          }
        />
      }
    >
      <SkillList />
      <SkillBootstrap />
      <SkillCatalogList />
      <AddSkillModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDispatch={handleDispatch}
        initialView={initialView}
      />
    </ScreenShell>
  );
}
