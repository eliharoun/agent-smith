import { useState } from "react";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

export function NpmForm({ existingIds, onSubmit, formId }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [pkg, setPkg] = useState("");
  const idErr = validateId(c.id, existingIds);
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !pkg) return;
        onSubmit({
          request: {
            typeOrUrl: "npm",
            pathOrUrl: pkg,
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
        label="package"
        required
        value={pkg}
        onChange={(e) => setPkg(e.target.value)}
        placeholder="@scope/name or name"
      />
    </form>
  );
}
