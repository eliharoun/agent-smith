import type { JobRequest } from "gui-shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStartJob } from "@/hooks/useStartJob";
import { previewFor } from "@/lib/argv-preview";
import { useModeStore } from "@/store/mode";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { CliPreview } from "@/ui/CliPreview";
import { FormField } from "@/ui/FormField";

interface TemplateCard {
  slug: string;
  label: string;
  description: string;
}

const TEMPLATES: TemplateCard[] = [
  {
    slug: "incident-debugger",
    label: "Incident Debugger",
    description: "Investigate production issues from logs and metrics.",
  },
  {
    slug: "repo-cartographer",
    label: "Repo Cartographer",
    description: "Map a codebase and answer where-is-X questions.",
  },
  {
    slug: "",
    label: "Empty agent (advanced)",
    description: "Start from a blank slate.",
  },
];

interface Props {
  onDispatch?: (req: JobRequest) => void;
  onSuccess?: (name: string) => void;
}

export function AgentCreateWizard({ onDispatch, onSuccess }: Props = {}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<string>("incident-debugger");
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const mode = useModeStore((s) => s.mode);
  const start = useStartJob();
  const nav = useNavigate();
  const validName = /^[a-z][a-z0-9-]*$/.test(name);
  const trimmedDescription = description.trim();
  const validDescription = trimmedDescription.length >= 10 && trimmedDescription.length <= 200;
  const valid = validName && validDescription;
  const request: JobRequest = {
    command: "agent.init",
    name: name || "<name>",
    description: trimmedDescription || "<description>",
    ...(template ? { template } : {}),
  };

  function handleCreate() {
    if (!valid) return;
    if (onDispatch) {
      onDispatch(request);
      onSuccess?.(name);
    } else {
      start.mutate(request, { onSuccess: () => nav(`/agents/${name}`) });
    }
  }

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // start from template
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {TEMPLATES.map((t) => (
          <button
            key={t.slug || "blank"}
            type="button"
            aria-pressed={template === t.slug}
            onClick={() => setTemplate(t.slug)}
            className={`text-left p-3 border font-mono text-xs transition-colors ${
              template === t.slug
                ? "border-matrix-green text-matrix-green"
                : "border-matrix-line text-matrix-body hover:border-matrix-green-muted"
            } ${t.slug === "" ? "opacity-75" : ""}`}
          >
            <div className="font-semibold mb-1">{t.label}</div>
            <div className="text-matrix-green-muted text-[10px] leading-snug">{t.description}</div>
          </button>
        ))}
      </div>
      <FormField
        label="name (lowercase, hyphens ok)"
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
          label="one-line description (10–200 chars)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setDescriptionTouched(true)}
          error={
            descriptionTouched && description && !validDescription
              ? trimmedDescription.length < 10
                ? "description must be at least 10 characters"
                : "description must be at most 200 characters"
              : ""
          }
        />
        <div className="text-right font-mono text-[10px] text-matrix-green-muted mt-0.5">
          {trimmedDescription.length} / 200
        </div>
      </div>
      {mode === "expert" && (
        <div className="mt-4">
          <CliPreview command={previewFor(request)} />
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button disabled={!valid} onClick={handleCreate}>
          create agent
        </Button>
      </div>
    </Card>
  );
}
