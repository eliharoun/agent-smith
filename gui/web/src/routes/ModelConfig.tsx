import { ModelConfigPage } from "@/panels/ModelConfig";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function ModelConfigScreen() {
  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Model Config"
          subtitle="// provider preferences and tier resolution settings"
        />
      }
    >
      <ModelConfigPage />
    </ScreenShell>
  );
}
