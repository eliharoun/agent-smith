import { z } from "zod";
import type { ZodError } from "zod";
import type { CanonicalConfig, CanonicalModelTier } from "./types";
import { PERMISSION_ACTIONS, normalizeModelTier } from "./types";
import { KnowledgeBlockSchema } from "./knowledge/schema";
import { KEBAB } from "./kebab";

const SKILL_NAME_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ACTION_PHRASE = /^(Use\b|[A-Z][a-z]+s?\b)/;

const PermissionAction = z.enum(PERMISSION_ACTIONS);
/** Bare action or per-pattern record. */
const PermissionGroupValue = z.union([PermissionAction, z.record(z.string(), PermissionAction)]);

const RequiresSchema = z.object({
  skills: z
    .array(
      z.object({
        catalog: z.string().min(1).optional(),
        name: z
          .string()
          .min(1)
          .regex(SKILL_NAME_KEBAB, "skill name must be lowercase letters/digits/hyphens"),
      }),
    )
    .optional(),
});

const LineRangeSchema = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([min, max]) => max >= min, {
    message: "max must be >= min",
  });

/**
 * The structural permission schema. Unknown keys are stripped by zod 4's
 * `.object()` before refines run; callers should use `parseConfig()` (below).
 */
export const CanonicalConfigSchema = z.object({
  /**
   * Schema-format version. Currently `1` (literal). v1 contract per B10:
   * required, must equal 1. Migration of legacy on-disk configs missing
   * this field is handled by `parseConfig()` (read-only, in-memory injection).
   * Future v2 schema changes bump this literal and add a migration branch.
   */
  schemaVersion: z.literal(1),
  name: z
    .string()
    .min(1)
    .regex(KEBAB, "name must be kebab-case (lowercase letters, digits, hyphens)"),
  description: z
    .string()
    .min(10, "description must be at least 10 characters")
    .max(200, "description must be at most 200 characters")
    .regex(
      ACTION_PHRASE,
      "description should start with an action phrase (e.g. 'Use proactively...', 'Reviews...', 'Builds...')",
    ),
  targets: z
    .array(z.enum(["opencode", "claude-code", "codex", "kiro"]))
    .min(1, "at least one target required"),
  modelTier: z
    .enum(["high", "balanced", "fast", "opus", "sonnet", "haiku", "inherit"])
    .transform((v) => normalizeModelTier(v as any) as CanonicalModelTier),
  model: z.string().min(1, "model must not be empty").optional(),
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  color: z.string().optional(),
  permission: z.record(z.string(), PermissionGroupValue).optional(),
  mcpServers: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  knowledge: KnowledgeBlockSchema.optional(),
  requires: RequiresSchema.optional(),
  // Per-bundle platform-convention declaration (Task 3.4). Each value is
  // a list of convention IDs from src/core/platform-conventions.ts. Bundle
  // author's intent wins over user-global preferences and CLI flags.
  // Validation is loose on the value list (free-form strings) — unknown
  // IDs are silently ignored at resolve time, mirroring the saved-prefs
  // behavior in src/io/conventions.ts.
  //
  // Schema-as-object (rather than z.record) because the Normalize/Equal
  // type assert below expects per-key optional-with-omit semantics; zod's
  // record produces an index signature that doesn't satisfy that shape.
  platformConventions: z
    .object({
      opencode: z.array(z.string()).optional(),
      "claude-code": z.array(z.string()).optional(),
      codex: z.array(z.string()).optional(),
      kiro: z.array(z.string()).optional(),
    })
    .optional(),
  thresholds: z
    .object({
      lineRanges: z
        .object({
          identity: LineRangeSchema.optional(),
          expertise: LineRangeSchema.optional(),
          soul: LineRangeSchema.optional(),
          user: LineRangeSchema.optional(),
        })
        .optional(),
      warnChars: z.number().int().min(1).optional(),
    })
    .optional(),
});

// Compile-time check that the schema's inferred output equals CanonicalConfig.
// We can't use `satisfies z.ZodType<CanonicalConfig>` because exactOptionalPropertyTypes
// makes CanonicalConfig's optional fields strict-omit (not `T | undefined`), while
// zod's .optional() infers `T | undefined`. This Equal helper compares the two
// statically; if they ever diverge the type _Check fails to compile.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type SchemaOutput = z.infer<typeof CanonicalConfigSchema>;
// Allow `T | undefined` on optional fields in the schema output (zod's behavior)
// without forcing the same on CanonicalConfig. Recurse into objects and arrays
// so nested unions (e.g. KnowledgeSource discriminated union) compare structurally.
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
type IsTuple<T> = T extends readonly unknown[]
  ? number extends T["length"]
    ? false
    : true
  : false;
type NormalizeValue<V> =
  IsTuple<V> extends true
    ? { [K in keyof V]: NormalizeValue<V[K]> }
    : V extends Array<infer U>
      ? Array<NormalizeValue<U>>
      : V extends object
        ? Normalize<V>
        : V;
type Normalize<T> = {
  [K in RequiredKeys<T>]: NormalizeValue<Exclude<T[K], undefined>>;
} & {
  [K in OptionalKeys<T>]?: NormalizeValue<Exclude<T[K], undefined>>;
};
type Flatten<T> = { [K in keyof T]: T[K] };
// Bidirectional assignability check rather than strict structural Equal:
// the discriminated KnowledgeSource union plus deep Normalize makes strict
// Equal too brittle (mapped-type modifier variance trips it), but mutual
// assignability still catches real drift between schema and canonical types.
type AssignableBoth<X, Y> = X extends Y ? (Y extends X ? true : false) : false;
type _Check =
  AssignableBoth<Flatten<Normalize<SchemaOutput>>, Flatten<CanonicalConfig>> extends true
    ? true
    : never;
const _check: _Check = true;
// Reference Equal so it stays in scope for future tightening if needed.
type _EqualUnused = Equal<true, true>;

/**
 * Format a ZodError's issues as `<path>: <message>` strings, mirroring the
 * `errors: string[]` shape returned by `validate()` and `validateKnowledge()`.
 * Top-level shape errors (empty path) are labelled `(root)`.
 */
export function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

export type ParseResult =
  | { success: true; data: CanonicalConfig }
  | { success: false; errors: string[] };

/** Strip keys whose value is `undefined`, so the result satisfies
 * exactOptionalPropertyTypes (omitted vs. present-as-undefined). */
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function parseConfig(input: unknown): ParseResult {
  const migrated = migrateMissingSchemaVersion(input);
  const result = CanonicalConfigSchema.safeParse(migrated);
  if (result.success)
    return { success: true, data: stripUndefined(result.data) as CanonicalConfig };
  return { success: false, errors: formatZodError(result.error) };
}

/**
 * B10 migration: if `input` is a plain object missing `schemaVersion`,
 * return a copy with `schemaVersion: 1` injected. Read-only: the caller's
 * input is not mutated and no disk write happens here.
 *
 * Migration is intentionally narrow:
 *   - Only inject when the field is absent. An explicit wrong value
 *     (e.g. `schemaVersion: 2`) falls through to validation failure.
 *   - Only operate on plain objects; primitives and arrays pass through.
 */
function migrateMissingSchemaVersion(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if ("schemaVersion" in obj) return input;
  return { schemaVersion: 1, ...obj };
}
