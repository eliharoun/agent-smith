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

/**
 * Coerce free-form text into the kebab-case id the schema expects
 * (`^[a-z0-9][a-z0-9-]*$`). Splits camelCase, lowercases, turns any run of
 * non-alphanumerics into a single hyphen, and strips leading hyphens.
 *
 * Applied on every keystroke in the id field, so it stays gentle: a single
 * trailing hyphen survives (the user is mid-word, e.g. "foo " → "foo-"),
 * only consecutive separators collapse. Idempotent — re-running on an
 * already-kebab value is a no-op.
 */
export function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // split camelCase boundaries
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of separators → one hyphen
    .replace(/^-+/, ""); // ids may not start with a hyphen
}

/**
 * Best-effort id inference from a URL, used by the URL form to pre-fill the
 * id field before the user has touched it. Prefers the last meaningful path
 * segment (skipping trailing slashes, file extensions, pure-numeric
 * segments like dates/ids, and `index` filenames); falls back to the
 * hostname's primary label (sans `www.` and TLD). Returns "" for input
 * that isn't a parseable URL yet.
 */
export function inferIdFromUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/\.[a-z0-9]+$/i, "")); // drop a file extension
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (/^\d+$/.test(seg)) continue; // bare number (date/id) — uninformative
    if (/^index$/i.test(seg)) continue; // index.html and friends
    const id = toKebabCase(decodeURIComponent(seg));
    if (id) return id;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  return toKebabCase(host.split(".")[0] ?? host);
}

export function commonFields(
  c: CommonFields,
  setC: Dispatch<SetStateAction<CommonFields>>,
  idErr?: string,
  /**
   * Called when the user types in the id field (after kebab-coercion). The
   * URL form uses this to mark the id as user-owned and stop auto-inferring
   * it from the URL.
   */
  onIdEdit?: () => void,
) {
  return (
    <>
      <FormField
        label="id"
        fieldId="knowledge.id"
        required
        value={c.id}
        onChange={(e) => {
          onIdEdit?.();
          const id = toKebabCase(e.target.value);
          setC((p) => ({ ...p, id }));
        }}
        error={c.id ? idErr : undefined}
        placeholder="my-source"
      />
      <FormField
        label="description"
        fieldId="knowledge.description"
        value={c.description}
        onChange={(e) => setC((p) => ({ ...p, description: e.target.value }))}
        placeholder="optional one-line summary"
      />
    </>
  );
}
