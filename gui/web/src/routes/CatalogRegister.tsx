import { useSearchParams } from "react-router-dom";
import { CatalogRegisterForm } from "@/panels/CatalogRegisterForm";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function CatalogRegister() {
  const [params] = useSearchParams();
  const raw = params.get("registry");
  const initialRegistry: "agent" | "skill" = raw === "skill" ? "skill" : "agent";
  return (
    <ScreenShell chrome={<Chrome title="Register catalog" subtitle="// agent or skill registry" />}>
      <CatalogRegisterForm initialRegistry={initialRegistry} />
    </ScreenShell>
  );
}
