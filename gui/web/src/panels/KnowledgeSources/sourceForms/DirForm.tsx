import { useState } from "react";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

export function DirForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [path, setPath] = useState("");
  const idErr = validateId(c.id, existingIds);
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !path) return;
        onSubmit({
          request: {
            typeOrUrl: "dir",
            pathOrUrl: path,
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
        label="directory"
        fieldId="knowledge.path"
        required
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/abs/path/to/dir"
        hint="include/exclude filters are not yet supported by `smith knowledge add`. Edit knowledge.yml directly to add them."
      />
    </form>
  );
}
