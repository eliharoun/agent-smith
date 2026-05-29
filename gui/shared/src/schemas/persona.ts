import { z } from "zod";

// Names of the four canonical persona files inside an agent bundle. Source of
// truth lives in the CLI's bundle layout (see `src/io/installer.ts` and the
// GUI server's `scan-bundle.ts`); this enum names them without the `.md`
// suffix to make URL paths cleaner. The route appends `.md` server-side.
export const PersonaFile = z.enum(["IDENTITY", "EXPERTISE", "SOUL", "USER"]);
export type PersonaFile = z.infer<typeof PersonaFile>;

// Persona files are typically a few KB. 1 MiB is a generous upper bound that
// rejects accidental paste of huge blobs (and any obvious abuse via the API)
// without constraining legitimate authoring.
export const PersonaContent = z.object({ content: z.string().max(1_048_576) });
export type PersonaContent = z.infer<typeof PersonaContent>;
