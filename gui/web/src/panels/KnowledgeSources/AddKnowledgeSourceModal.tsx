import type { KnowledgeSource } from "gui-shared";
import { useState } from "react";
import { useAgent, useSaveAgentConfig } from "@/hooks/useAgents";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { ConfluenceForm } from "./sourceForms/ConfluenceForm";
import { DirForm } from "./sourceForms/DirForm";
import { FileForm } from "./sourceForms/FileForm";
import { GitForm } from "./sourceForms/GitForm";
import { GlobForm } from "./sourceForms/GlobForm";
import { JiraForm } from "./sourceForms/JiraForm";
import { NpmForm } from "./sourceForms/NpmForm";
import type { FormSubmit, SourceFormProps } from "./sourceForms/types";
import { UrlForm } from "./sourceForms/UrlForm";

type SourceType = "file" | "dir" | "glob" | "url" | "git" | "npm" | "confluence" | "jira";

const FORMS: Record<SourceType, (p: SourceFormProps) => JSX.Element> = {
  file: FileForm,
  dir: DirForm,
  glob: GlobForm,
  url: UrlForm,
  git: GitForm,
  npm: NpmForm,
  confluence: ConfluenceForm,
  jira: JiraForm,
};

const TYPE_DESCRIPTIONS: Record<SourceType, string> = {
  file: "single file on disk",
  dir: "directory of files (markdown / text)",
  glob: "file glob pattern",
  url: "fetch from an http(s) URL",
  git: "shallow clone of a git repo",
  npm: "package contents from npm",
  confluence: "Confluence space or pages",
  jira: "Jira issues matching a JQL query",
};

interface Props {
  agent: string;
  existingIds: string[];
  onClose: () => void;
}

/**
 * Two-stage modal: pick type → render the matching form. Save reads the
 * form's onSubmit payload, builds a `knowledge.add` JobRequest, and
 * dispatches via useStartJob. JobCompletionListener invalidates
 * ['knowledge', agent] on exit (Task 19).
 *
 * Routing-aware save (v1.4): when the URL form returns a `via` pick, the
 * modal does NOT go through `knowledge.add` (the CLI doesn't accept a
 * `--via` flag — its picker is interactive). Instead it writes the new
 * source directly to `agent.config.json#knowledge` via PUT, mirroring the
 * Edit modal. This keeps the round-trip aligned with the schema (the
 * canonical KnowledgeBlockSchema is the source of truth) and lets the
 * modal extend `mcpServers[]` atomically when the picked server isn't
 * already declared.
 */
export function AddKnowledgeSourceModal({ agent, existingIds, onClose }: Props) {
  const [type, setType] = useState<SourceType | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const start = useStartJob();
  const detail = useAgent(agent);
  const saveConfig = useSaveAgentConfig(agent);
  const formId = "knowledge-add-form";

  const Form = type ? FORMS[type] : null;

  const handleSubmit = async (s: FormSubmit) => {
    setSubmitErr(null);
    if (s.errors && Object.keys(s.errors).length > 0) return;

    if (s.via) {
      // Routed-URL save path: skip the `knowledge.add` job (no --via flag)
      // and write the source straight to agent.config.json. We round-trip
      // the entire knowledge block + mcpServers array; the server replaces
      // both in one write so the install pipeline sees the consistent
      // post-add state on its next materialize.
      const config = (detail.data?.config as Record<string, unknown> | undefined) ?? {};
      const existingBlock =
        (config.knowledge as { sources?: KnowledgeSource[]; [k: string]: unknown } | undefined) ??
        {};
      const existingSources = (existingBlock.sources ?? []) as KnowledgeSource[];
      const newSource: Record<string, unknown> = {
        id: s.request.id,
        type: "url",
        url: s.request.typeOrUrl,
        delivery: s.request.delivery ?? "auto",
        via: { server: s.via.server, tool: s.via.tool },
      };
      if (s.request.description) newSource.description = s.request.description;
      if (s.request.optional) newSource.optional = true;
      const nextBlock = { ...existingBlock, sources: [...existingSources, newSource] };

      // Extend the bundle's mcpServers[] when the picked server is new.
      // Mirrors the CLI's `chosenServerToAdd` arm in knowledge add: the
      // declaration is what the install pipeline reads to wire the server.
      const existingServers = Array.isArray(config.mcpServers)
        ? (config.mcpServers as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const nextServers =
        s.via.serverWasAdded && !existingServers.includes(s.via.server)
          ? [...existingServers, s.via.server]
          : null;

      const patch: Record<string, unknown> = {
        knowledge: nextBlock as unknown as Record<string, unknown>,
      };
      if (nextServers) patch.mcpServers = nextServers;

      try {
        await saveConfig.mutateAsync(patch as Parameters<typeof saveConfig.mutateAsync>[0]);
        onClose();
      } catch (err) {
        setSubmitErr(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    start.mutate({ command: "knowledge.add", agent, ...s.request });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-green bg-black p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm">
            // add knowledge source
          </h2>
          <Button variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        {!type ? (
          <div className="space-y-2">
            <div className="font-mono text-xs text-matrix-green-muted mb-2">
              choose a source type:
            </div>
            <ul className="space-y-1">
              {(Object.keys(FORMS) as SourceType[]).map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => setType(t)}
                    className="w-full text-left border border-matrix-line hover:border-matrix-green px-3 py-2"
                  >
                    <div className="font-mono text-sm text-matrix-body">{t}</div>
                    <div className="font-mono text-[10px] text-matrix-green-muted">
                      {TYPE_DESCRIPTIONS[t]}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Button variant="ghost" onClick={() => setType(null)}>
                ← back
              </Button>
              <span className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
                // {type}
              </span>
            </div>
            {Form && (
              <Form
                agent={agent}
                existingIds={existingIds}
                onSubmit={handleSubmit}
                formId={formId}
              />
            )}
            {submitErr && (
              <div className="font-mono text-[10px] text-matrix-red mt-3" role="alert">
                // error: {submitErr}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-matrix-line">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={start.isPending || saveConfig.isPending}
              >
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
