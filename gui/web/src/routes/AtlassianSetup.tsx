import { AtlassianEnvForm } from "@/panels/AtlassianEnvForm";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function AtlassianSetup() {
  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Atlassian Setup"
          subtitle="// credentials shared by Confluence + Jira knowledge sources"
        />
      }
    >
      <AtlassianEnvForm />
    </ScreenShell>
  );
}
