import type { Dispatch, SetStateAction } from "react";
import { FormField } from "@/ui/FormField";

export interface CommonFields {
  id: string;
  description: string;
}

export function validateId(id: string, existing: string[]): string | undefined {
  if (!id) return "id is required";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    return "lowercase alphanumeric + hyphens; must start with a letter or digit";
  if (existing.includes(id)) return "id already exists for this agent";
  return undefined;
}

export function commonFields(
  c: CommonFields,
  setC: Dispatch<SetStateAction<CommonFields>>,
  idErr?: string,
) {
  return (
    <>
      <FormField
        label="id"
        required
        value={c.id}
        onChange={(e) => setC((p) => ({ ...p, id: e.target.value }))}
        error={c.id ? idErr : undefined}
        placeholder="my-source"
      />
      <FormField
        label="description"
        value={c.description}
        onChange={(e) => setC((p) => ({ ...p, description: e.target.value }))}
        placeholder="optional one-line summary"
      />
    </>
  );
}
