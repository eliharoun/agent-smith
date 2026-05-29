import { useState } from "react";
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
 */
export function AddKnowledgeSourceModal({ agent, existingIds, onClose }: Props) {
  const [type, setType] = useState<SourceType | null>(null);
  const start = useStartJob();
  const formId = "knowledge-add-form";

  const Form = type ? FORMS[type] : null;

  const handleSubmit = (s: FormSubmit) => {
    if (s.errors && Object.keys(s.errors).length > 0) return;
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
            {Form && <Form existingIds={existingIds} onSubmit={handleSubmit} formId={formId} />}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-matrix-line">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form={formId} disabled={start.isPending}>
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
