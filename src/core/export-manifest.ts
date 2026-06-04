import { z } from "zod";

const HEX64 = z.string().regex(/^[0-9a-f]{64}$/);
const ISO_TS = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);

const McpDeps = z.object({
  required: z.array(z.string()),
  peer: z.array(z.string()),
  perAgent: z.array(z.string()),
});

const Credential = z.object({
  kind: z.literal("atlassian"),
  reason: z.string(),
  docPath: z.string(),
});

const SkillReq = z.object({ name: z.string(), embedded: z.boolean() });

const RemoteKnowledge = z.object({
  id: z.string(),
  type: z.enum(["url", "git", "confluence", "jira"]),
  endpoint: z.string(),
});

const ContentFile = z.object({
  path: z.string(),
  sha256: HEX64,
  size: z.number().int().nonnegative(),
});

export const ExportManifestSchema = z.object({
  exportSchemaVersion: z.literal(1),
  bundle: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/, "must be kebab-case 1-64 chars"),
    contentHash: HEX64,
  }),
  producedBy: z.object({
    smithVersion: z.string(),
    exportedAt: ISO_TS,
    sourceSha: z.string().nullable(),
    userAgent: z.string(),
  }),
  requires: z.object({
    minSmithVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a semver-shaped string"),
    mcpServers: McpDeps,
    credentials: z.array(Credential),
    skills: z.array(SkillReq),
    remoteKnowledge: z.array(RemoteKnowledge),
  }),
  contents: z.object({
    files: z.array(ContentFile),
    knowledgeSnapshots: z.array(z.never()),
    skillBundles: z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative() })),
  }),
  omitted: z.object({ skills: z.array(z.string()) }),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

/**
 * Render the user-facing README.md that ships inside the archive.
 * Recipients see this if they extract the .tgz manually; smith's install
 * pipeline does not consume it.
 */
export function manifestToReadme(m: ExportManifest): string {
  const lines: string[] = [];
  lines.push(`# ${m.bundle.name}`);
  lines.push("");
  lines.push(`Exported with smith ${m.producedBy.smithVersion} at ${m.producedBy.exportedAt}.`);
  lines.push("");
  lines.push("## Install");
  lines.push("");
  lines.push("```bash");
  lines.push(`smith agent install --from <path-to-this-archive>`);
  lines.push("```");
  lines.push("");

  const r = m.requires;
  const needs: string[] = [];
  if (r.mcpServers.required.length > 0) {
    needs.push(`MCP server(s): ${r.mcpServers.required.join(", ")}`);
  }
  if (r.credentials.length > 0) {
    needs.push(`Credentials: ${r.credentials.map((c) => c.kind).join(", ")}`);
  }
  if (r.remoteKnowledge.length > 0) {
    const eps = r.remoteKnowledge.map((rk) => rk.endpoint).join(", ");
    needs.push(`Network access (sources fetched at install): ${eps}`);
  }
  if (m.omitted.skills.length > 0) {
    needs.push(`Skills resolved from your registered catalogs: ${m.omitted.skills.join(", ")}`);
  }
  if (needs.length > 0) {
    lines.push("## What you'll need");
    lines.push("");
    for (const n of needs) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}
