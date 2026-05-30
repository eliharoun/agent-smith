// gui/shared/src/schemas/remote.ts
//
// C4.1.1 (v1-task): RemoteBlock — wire-shape mirror of the on-disk
// `Remote` interface in src/core/types.ts. Exposed on AgentSummary and
// SkillSummary so the GUI can render drift state (ahead/behind/clean)
// without making a separate registry call.
//
// Kept in lock-step with src/core/types.ts:Remote — any change to that
// interface must also bump this schema. The `lastPulled*` and
// `lastRemote*` fields are optional because a freshly-created remote
// entry can briefly exist without them (between catalog registration
// and the first daemon poll).

import { z } from "zod";

const Sha40 = z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-char hex SHA");
const Iso8601 = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "must be an ISO-8601 date string" });

export const RemoteBlock = z.object({
  url: z.string().min(1),
  ref: z.string(),
  lastPulledSha: Sha40.optional(),
  lastPulledAt: Iso8601.optional(),
  lastRemoteSha: Sha40.optional(),
  lastCheckedAt: Iso8601.optional(),
});
export type RemoteBlock = z.infer<typeof RemoteBlock>;
