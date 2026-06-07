import { z } from "zod";
import { RemoteBlock } from "./remote";

export const Platform = z.enum(["opencode", "claude-code", "codex", "kiro"]);
export type Platform = z.infer<typeof Platform>;

// Render target — superset of Platform that adds the cross-tool AGENTS.md
// emission target. Use for any field that names where smith renders to.
// Use Platform (no agents-md) for fields about runtime, auth, refresh
// consent, or installed-status — agents-md has no runtime of its own.
export const Target = z.enum(["opencode", "claude-code", "codex", "kiro", "agents-md"]);
export type Target = z.infer<typeof Target>;

export const AgentSummary = z.object({
  name: z.string(),
  description: z.string(),
  catalog: z.string(),
  path: z.string(),
  model: z.string().optional(),
  targets: z.array(Target),
  // C4.1.2: optional remote{} block surfacing registry drift state for
  // catalogs installed via `smith agent install --from <url>`. Absent for
  // locally-authored agents.
  remote: RemoteBlock.optional(),
  // True for system bundles managed by smith (agent-smith). Server sets it
  // explicitly via isProtectedAgent; absent reads as not-protected on the
  // client, so older servers stay backward-compatible.
  protected: z.boolean().optional(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentDetail = AgentSummary.extend({
  identity: z.string(),
  expertise: z.string(),
  soul: z.string(),
  user: z.string(),
  // Intentionally loose: agent.config.json schema is owned by the smith CLI;
  // GUI round-trips without re-validating to avoid drift.
  config: z.record(z.string(), z.unknown()),
});
export type AgentDetail = z.infer<typeof AgentDetail>;

export const InstalledStatus = z.object({
  agent: z.string(),
  // zod 4: partialRecord allows a subset of keys from the enum (vs z.record which requires all)
  installed: z.partialRecord(Platform, z.boolean()),
});
export type InstalledStatus = z.infer<typeof InstalledStatus>;

// zod 4: z.record(z.string(), V) is a non-partial record over arbitrary string
// keys (vs z.partialRecord(Enum, V) which is for enum-keyed partial records).
export const InstalledStatusBulk = z.record(z.string(), InstalledStatus);
export type InstalledStatusBulk = z.infer<typeof InstalledStatusBulk>;

export const RefreshManifestRead = z.object({
  agent: z.string(),
  platforms: z.array(Platform),
});
export type RefreshManifestRead = z.infer<typeof RefreshManifestRead>;
