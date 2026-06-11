import { useState } from "react";
import { FieldHelp } from "@/ui/FieldHelp";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

type Preset = "" | "notion" | "github" | "slack";

const PRESETS: Record<Exclude<Preset, "">, { server: string; tool: string }> = {
  notion: { server: "notion-mcp", tool: "search" },
  github: { server: "github-mcp", tool: "search_repositories" },
  slack: { server: "slack-mcp", tool: "search_messages" },
};

export function McpForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [preset, setPreset] = useState<Preset>("");
  const [server, setServer] = useState("");
  const [tool, setTool] = useState("");
  const idErr = validateId(c.id, existingIds);

  const handlePreset = (v: Preset) => {
    setPreset(v);
    if (v && PRESETS[v]) {
      setServer(PRESETS[v].server);
      setTool(PRESETS[v].tool);
    }
  };

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !server || !tool) return;
        onSubmit({
          request: {
            typeOrUrl: "mcp",
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            includeChildren: false,
            server,
            tool,
            ...(preset ? { preset } : {}),
          },
        });
      }}
      className="space-y-3"
    >
      {commonFields(c, setC, idErr)}
      <div className="flex flex-col gap-1">
        <FieldHelp fieldId="knowledge.mcp.preset" htmlFor="mcp-preset">
          preset
        </FieldHelp>
        <select
          id="mcp-preset"
          aria-label="preset"
          value={preset}
          onChange={(e) => handlePreset(e.target.value as Preset)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
        >
          <option value="">(none)</option>
          <option value="notion">notion</option>
          <option value="github">github</option>
          <option value="slack">slack</option>
        </select>
      </div>
      <FormField
        label="server"
        fieldId="knowledge.mcp.server"
        required
        value={server}
        onChange={(e) => setServer(e.target.value)}
        placeholder="my-mcp-server"
      />
      <FormField
        label="tool"
        fieldId="knowledge.mcp.tool"
        required
        value={tool}
        onChange={(e) => setTool(e.target.value)}
        placeholder="search"
      />
    </form>
  );
}
