import { InstallMatrixGrid } from "@/panels/InstallMatrixGrid";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function InstallMatrix() {
  return (
    <ScreenShell chrome={<Chrome title="Install Matrix" subtitle="agents × platforms" />}>
      <InstallMatrixGrid />
    </ScreenShell>
  );
}
