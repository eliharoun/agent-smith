import { useState } from "react";
import { FieldHelp } from "@/ui/FieldHelp";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

type Mode = "crawl" | "llms-txt" | "openapi";

const MODE_BLURB: Record<Mode, string> = {
  crawl: "Follow links from the start URL up to max pages / depth.",
  "llms-txt": "Fetch the site's llms.txt manifest and all referenced pages.",
  openapi: "Fetch an OpenAPI / Swagger spec and materialise as markdown.",
};

export function WebForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("crawl");
  const [maxPages, setMaxPages] = useState("");
  const [depth, setDepth] = useState("");
  const idErr = validateId(c.id, existingIds);

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !url) return;
        const mp = maxPages ? Number(maxPages) : undefined;
        const d = depth ? Number(depth) : undefined;
        onSubmit({
          request: {
            typeOrUrl: "web",
            pathOrUrl: url,
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            includeChildren: false,
            mode,
            ...(mode === "crawl" && mp && Number.isFinite(mp) ? { maxPagesWeb: mp } : {}),
            ...(mode === "crawl" && d && Number.isFinite(d) ? { depth: d } : {}),
          },
        });
      }}
      className="space-y-3"
    >
      {commonFields(c, setC, idErr)}
      <FormField
        label="url"
        fieldId="knowledge.web.url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://docs.example.com"
      />
      <div className="flex flex-col gap-1">
        <FieldHelp fieldId="knowledge.web.mode" htmlFor="web-mode">
          mode
        </FieldHelp>
        <select
          id="web-mode"
          aria-label="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
        >
          <option value="crawl">crawl</option>
          <option value="llms-txt">llms-txt</option>
          <option value="openapi">openapi</option>
        </select>
        <span className="font-mono text-[10px] text-matrix-green-muted">{MODE_BLURB[mode]}</span>
      </div>
      {mode === "crawl" && (
        <>
          <FormField
            label="max pages"
            fieldId="knowledge.web.maxPages"
            value={maxPages}
            onChange={(e) => setMaxPages(e.target.value.replace(/\D/g, ""))}
            placeholder="50"
          />
          <FormField
            label="depth"
            fieldId="knowledge.web.depth"
            value={depth}
            onChange={(e) => setDepth(e.target.value.replace(/\D/g, ""))}
            placeholder="3"
          />
        </>
      )}
    </form>
  );
}
