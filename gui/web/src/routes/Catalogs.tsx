import type { JobRequest } from "gui-shared";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AddAgentModal } from "@/panels/AddAgentModal/AddAgentModal";
import { CatalogList } from "@/panels/CatalogList";
import { useJobToast } from "@/hooks/useJobToast";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function Catalogs() {
  const [addOpen, setAddOpen] = useState(false);
  const [searchParams] = useSearchParams();

  const registryParam = searchParams.get("registry");
  const initialRegistry: "agent" | "skill" | undefined =
    registryParam === "skill" ? "skill" : registryParam === "agent" ? "agent" : undefined;

  // Open on mount when ?add=register is present.
  useEffect(() => {
    if (searchParams.get("add") === "register") {
      setAddOpen(true);
    }
    // Run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { dispatch } = useJobToast({
    command: "agent.register",
    label: {
      progress: () => "Registering catalog…",
      success: () => "Catalog registered",
      error: () => "Registration failed",
    },
  });

  function handleDispatch(req: JobRequest) {
    dispatch(req);
    setAddOpen(false);
  }

  return (
    <>
      <ScreenShell
        chrome={
          <Chrome
            title="Catalogs"
            subtitle="// where agents and skills are sourced from"
            actions={
              <Button onClick={() => setAddOpen(true)}>+ Register</Button>
            }
          />
        }
      >
        <CatalogList />
      </ScreenShell>
      <AddAgentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDispatch={handleDispatch}
        initialView="register"
        lockedView
        {...(initialRegistry ? { initialRegistry } : {})}
      />
    </>
  );
}
