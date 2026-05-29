import { useState } from "react";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

export function FileForm({ existingIds, onSubmit, formId }: SourceFormProps) {
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
            typeOrUrl: "file",
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
        label="path"
        required
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/abs/path/to/file.md"
      />
    </form>
  );
}
