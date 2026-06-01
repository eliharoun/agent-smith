import { useState } from "react";
import { useAtlassianEnv } from "@/hooks/useAtlassianEnv";
import { useParseKnowledgeUrl } from "@/hooks/useParseKnowledgeUrl";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { FieldHelp } from "@/ui/FieldHelp";
import { FormField } from "@/ui/FormField";
import { Toggle } from "@/ui/Toggle";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

/**
 * Confluence form. Accepts either a space key (with optional comma-separated
 * page IDs) OR pastes a Confluence URL which we parse via
 * `useParseKnowledgeUrl()` to extract `space` (and `pageId` if applicable).
 *
 * Renders a "requires .env" chip when useAtlassianEnv reports `present: false`.
 */
export function ConfluenceForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [space, setSpace] = useState("");
  const [pages, setPages] = useState("");
  const [includeChildren, setIncludeChildren] = useState(false);
  const [maxPages, setMaxPages] = useState<string>("");
  const [format, setFormat] = useState<"storage" | "view" | "markdown" | "">("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteHint, setPasteHint] = useState<string | undefined>();
  const parse = useParseKnowledgeUrl();
  const env = useAtlassianEnv();

  const idErr = validateId(c.id, existingIds);

  const doParse = async () => {
    if (!pasteUrl) return;
    try {
      const r = await parse.mutateAsync(pasteUrl);
      if (r.kind === "confluence-page") {
        setSpace(r.space);
        setPages((prev) => (prev ? `${prev},${r.pageId}` : r.pageId));
        setPasteHint(`✓ parsed (page ${r.pageId} in ${r.space})`);
      } else if (r.kind === "confluence-space") {
        setSpace(r.space);
        setPasteHint(`✓ parsed (space ${r.space})`);
      } else if (r.kind === "confluence-blog") {
        setSpace(r.space);
        setPasteHint(`✓ parsed (blog post ${r.postId} in ${r.space})`);
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
        if (idErr || !space) return;
        const m = maxPages ? Number(maxPages) : undefined;
        onSubmit({
          request: {
            typeOrUrl: "confluence",
            pathOrUrl: space,
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            ...(pages ? { pages } : {}),
            includeChildren,
            ...(m && Number.isFinite(m) ? { maxPages: m } : {}),
            ...(format ? { format } : {}),
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
          // paste a confluence url (optional)
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
              placeholder="https://acme.atlassian.net/wiki/spaces/ENG/pages/12345"
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

      <FormField
        label="space key"
        fieldId="knowledge.confluence.space"
        required
        value={space}
        onChange={(e) => setSpace(e.target.value)}
        placeholder="ENG"
      />
      <FormField
        label="pages (csv of page ids)"
        fieldId="knowledge.confluence.pages"
        value={pages}
        onChange={(e) => setPages(e.target.value)}
        placeholder="12345,67890"
      />
      <div className="flex gap-4 items-center">
        <div className="inline-flex items-center gap-1">
          <Toggle
            label="include children"
            checked={includeChildren}
            onChange={setIncludeChildren}
          />
          <FieldHelp fieldId="knowledge.confluence.includeChildren" iconOnly>
            include children help
          </FieldHelp>
        </div>
        <FormField
          label="max pages"
          fieldId="knowledge.confluence.maxPages"
          value={maxPages}
          onChange={(e) => setMaxPages(e.target.value.replace(/\D/g, ""))}
          placeholder="100"
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldHelp fieldId="knowledge.confluence.format" htmlFor="confluence-format">
          format
        </FieldHelp>
        <select
          id="confluence-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
        >
          <option value="">(default)</option>
          <option value="markdown">markdown</option>
          <option value="storage">storage</option>
          <option value="view">view</option>
        </select>
      </div>
    </form>
  );
}
