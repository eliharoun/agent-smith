import { ExportDirSetting } from "@/panels/ExportDirSetting";
import { PortSetting } from "@/panels/PortSetting";
import { ThemeIntensity } from "@/panels/ThemeIntensity";
import { TourReset } from "@/panels/TourReset";
import { UserMdEditor } from "@/panels/UserMdEditor";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function SettingsScreen() {
  return (
    <ScreenShell chrome={<Chrome title="Settings" subtitle="system preferences" />}>
      <UserMdEditor />
      <PortSetting />
      <ExportDirSetting />
      <ThemeIntensity />
      <TourReset />
    </ScreenShell>
  );
}
