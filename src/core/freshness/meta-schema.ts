import { z } from "zod";
import type { SchemaMeta, ToolMapMeta } from "./types";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "lastVerifiedDate must be YYYY-MM-DD")
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
    },
    { message: "lastVerifiedDate must be a real calendar date" },
  );

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), { message: "sourceUrl must be https://" });

const ToolMapMetaSchema = z
  .object({
    lastVerifiedDate: isoDate,
    verifiedAgainstVersion: z.string().min(1),
    sourceUrl: httpsUrl,
    notes: z.string(),
  })
  .strict();

const SchemaMetaSchema = z
  .object({
    lastVerifiedDate: isoDate,
    sourceUrl: httpsUrl,
    schemaId: z.string().nullable(),
    version: z.string().nullable(),
    notes: z.string(),
  })
  .strict();

export function parseToolMapMeta(value: unknown): ToolMapMeta {
  return ToolMapMetaSchema.parse(value);
}

export function parseSchemaMeta(value: unknown): SchemaMeta {
  return SchemaMetaSchema.parse(value);
}

// Compile-time check that each schema's inferred output equals its hand-written
// type in ./types. Mirrors the Equal<> pattern in src/core/config-schema.ts. If
// the schema and the type ever drift, the _Check aliases fail to compile.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type _ToolMapMetaCheck =
  Equal<z.infer<typeof ToolMapMetaSchema>, ToolMapMeta> extends true ? true : never;
type _SchemaMetaCheck =
  Equal<z.infer<typeof SchemaMetaSchema>, SchemaMeta> extends true ? true : never;
const _toolMapMetaCheck: _ToolMapMetaCheck = true;
const _schemaMetaCheck: _SchemaMetaCheck = true;
