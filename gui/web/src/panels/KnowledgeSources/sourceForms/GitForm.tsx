import { useState } from "react";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

export function GitForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [url, setUrl] = useState("");
  const idErr = validateId(c.id, existingIds);
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !url) return;
        onSubmit({
          request: {
            typeOrUrl: "git",
            pathOrUrl: url,
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
        label="git url"
        fieldId="knowledge.url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo OR git@github.com:owner/repo.git"
        hint="ref/subpath/include filters are not yet supported by `smith knowledge add`. Edit knowledge.yml directly to add them."
      />
    </form>
  );
}
