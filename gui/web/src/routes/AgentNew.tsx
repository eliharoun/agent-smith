import { useState } from "react";
import { InstallFromUrlModal } from "@/panels/InstallFromUrlModal";
import { AgentCreateWizard } from "@/panels/AgentCreateWizard";
import { Chrome } from "@/ui/Chrome";
import { FormField } from "@/ui/FormField";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ScreenShell } from "@/ui/ScreenShell";

const URL_RE = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/;

export function AgentNew() {
  const [quickUrl, setQuickUrl] = useState("");
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlModalInitial, setUrlModalInitial] = useState("");

  function handleQuickInstall() {
    if (!quickUrl.trim()) return;
    if (URL_RE.test(quickUrl.trim())) {
      setUrlModalInitial(quickUrl.trim());
      setUrlModalOpen(true);
    }
  }

  return (
    <ScreenShell chrome={<Chrome title="New Agent" subtitle="scaffold a bundle" />}>
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
          // quick install from url
        </div>
        <div className="flex gap-2 items-end">
          <FormField
            label="git url"
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            placeholder="https://… or git@host:…"
            className="flex-1"
          />
          <Button
            disabled={!quickUrl.trim() || !URL_RE.test(quickUrl.trim())}
            onClick={handleQuickInstall}
          >
            Install
          </Button>
        </div>
      </Card>
      <AgentCreateWizard />
      <InstallFromUrlModal
        kind="agent"
        open={urlModalOpen}
        onClose={() => setUrlModalOpen(false)}
        initialUrl={urlModalInitial}
      />
    </ScreenShell>
  );
}
