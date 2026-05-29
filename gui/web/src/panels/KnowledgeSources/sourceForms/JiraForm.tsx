import { useState } from "react";
import { useAtlassianEnv } from "@/hooks/useAtlassianEnv";
import { useParseKnowledgeUrl } from "@/hooks/useParseKnowledgeUrl";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

/**
 * Jira form. typeOrUrl="jira", pathOrUrl=jql. URL paste auto-fills the JQL
 * for jira-issue / jira-jql URLs.
 */
export function JiraForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [jql, setJql] = useState("");
  const [fields, setFields] = useState("");
  const [maxResults, setMaxResults] = useState<string>("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteHint, setPasteHint] = useState<string | undefined>();
  const parse = useParseKnowledgeUrl();
  const env = useAtlassianEnv();

  const idErr = validateId(c.id, existingIds);

  const doParse = async () => {
    if (!pasteUrl) return;
    try {
      const r = await parse.mutateAsync(pasteUrl);
      if (r.kind === "jira-issue") {
        setJql(`key = ${r.key}`);
        setPasteHint(`✓ parsed (issue ${r.key})`);
      } else if (r.kind === "jira-jql") {
        setJql(r.jql);
        setPasteHint("✓ parsed JQL from URL");
      } else {
        setPasteHint(`unrecognised kind: ${r.kind}`);
      }
    } catch (e) {
      setPasteHint(`failed to parse: ${(e as Error).message}`);
    }
  };

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !jql) return;
        const m = maxResults ? Number(maxResults) : undefined;
        onSubmit({
          request: {
            typeOrUrl: "jira",
            pathOrUrl: jql,
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            includeChildren: false,
            ...(fields ? { fields } : {}),
            ...(m && Number.isFinite(m) ? { maxResults: m } : {}),
          },
        });
      }}
      className="space-y-3"
    >
      {env.data && !env.data.hasToken && (
        <a href="/system/atlassian-setup" target="_blank" rel="noreferrer" className="inline-block">
          <Chip tone="amber">requires .env — configure</Chip>
        </a>
      )}
      {commonFields(c, setC, idErr)}

      <div className="border border-matrix-line p-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // paste a jira url (optional)
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <FormField
              label="url"
              value={pasteUrl}
              onChange={(e) => {
                setPasteUrl(e.target.value);
                setPasteHint(undefined);
              }}
              placeholder="https://acme.atlassian.net/browse/PROJ-123"
              hint={pasteHint}
            />
          </div>
          <Button
            variant="ghost"
            disabled={!pasteUrl || parse.isPending}
            onClick={doParse}
            type="button"
          >
            parse
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="f-jql"
          className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted"
        >
          // jql (required)
        </label>
        <textarea
          id="f-jql"
          value={jql}
          onChange={(e) => setJql(e.target.value)}
          placeholder="project = ENG AND updated >= -30d"
          rows={3}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
        />
      </div>
      <FormField
        label="fields (csv)"
        value={fields}
        onChange={(e) => setFields(e.target.value)}
        placeholder="summary,status,priority"
      />
      <FormField
        label="max results"
        value={maxResults}
        onChange={(e) => setMaxResults(e.target.value.replace(/\D/g, ""))}
        placeholder="50"
      />
    </form>
  );
}
