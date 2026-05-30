import { CodexMigrationBanner } from "@/panels/CodexMigrationBanner";
import { DoctorCheckList } from "@/panels/DoctorCheckList";
import { DoctorFixButton } from "@/panels/DoctorFixButton";
import { DoctorRadial } from "@/panels/DoctorRadial";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function DoctorScreen() {
  return (
    <ScreenShell chrome={<Chrome title="Doctor" subtitle="system health" />}>
      <DoctorRadial />
      <CodexMigrationBanner />
      <DoctorFixButton />
      <DoctorCheckList />
    </ScreenShell>
  );
}
