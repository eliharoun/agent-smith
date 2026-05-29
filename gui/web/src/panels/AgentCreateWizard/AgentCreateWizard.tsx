import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStartJob } from "@/hooks/useStartJob";
import { previewFor } from "@/lib/argv-preview";
import { useModeStore } from "@/store/mode";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { CliPreview } from "@/ui/CliPreview";
import { FormField } from "@/ui/FormField";

export function AgentCreateWizard() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<string>("");
  const start = useStartJob();
  const mode = useModeStore((s) => s.mode);
  const nav = useNavigate();
  const validName = /^[a-z][a-z0-9-]*$/.test(name);
  const trimmedDescription = description.trim();
  const validDescription = trimmedDescription.length >= 10 && trimmedDescription.length <= 200;
  const valid = validName && validDescription;
  const request = {
    command: "agent.init" as const,
    name: name || "<name>",
    description: trimmedDescription || "<description>",
    ...(template ? { template } : {}),
  };
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // new agent
      </div>
      <FormField
        label="name (lowercase, hyphens)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={
          !validName && name
            ? "invalid; must start with a letter, lowercase, digits + hyphens only"
            : ""
        }
      />
      <div className="mt-3">
        <FormField
          label="description (10-200 chars)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={
            description && !validDescription
              ? trimmedDescription.length < 10
                ? "description must be at least 10 characters"
                : "description must be at most 200 characters"
              : ""
          }
        />
      </div>
      <div className="mt-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-1">
          // template (optional)
        </div>
        <div className="flex gap-2">
          {["", "incident-debugger", "repo-cartographer"].map((t) => (
            <Button
              key={t || "blank"}
              variant={template === t ? "primary" : "ghost"}
              onClick={() => setTemplate(t)}
            >
              {t || "blank"}
            </Button>
          ))}
        </div>
      </div>
      {mode === "expert" && (
        <div className="mt-4">
          <CliPreview command={previewFor(request)} />
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          disabled={!valid || start.isPending}
          onClick={async () => {
            await start.mutateAsync(request);
            nav(`/agents/${encodeURIComponent(name)}`);
          }}
        >
          Create
        </Button>
      </div>
    </Card>
  );
}
