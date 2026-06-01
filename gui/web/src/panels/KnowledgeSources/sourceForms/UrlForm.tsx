import { useState } from "react";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

/**
 * URL form. typeOrUrl is the URL itself (URL-shortcut form recognised by
 * the CLI when http(s) is passed as the first positional argument), so
 * pathOrUrl is omitted.
 */
export function UrlForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [url, setUrl] = useState("");
  const idErr = validateId(c.id, existingIds);
  const httpsWarn =
    url && !url.startsWith("https://") ? "non-https URL — content may be intercepted" : undefined;
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !url) return;
        onSubmit({
          request: {
            typeOrUrl: url,
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            includeChildren: false,
          },
        });
      }}
      className="space-y-3"
    >
      {commonFields(c, setC, idErr)}
      <FormField
        label="url"
        fieldId="knowledge.url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/page"
        hint={httpsWarn}
      />
    </form>
  );
}
