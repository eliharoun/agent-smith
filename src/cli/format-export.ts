import pc from "picocolors";

export interface ExportSummaryInput {
  bundleName: string;
  artifactPath: string;
  size: number;
  sha256: string;
  installCommand: string;
  embeddedSkills: number;
  remoteKnowledgeCount: number;
  mcpRequiredCount: number;
}

export function formatExportSummary(s: ExportSummaryInput): string {
  const lines: string[] = [];
  lines.push(pc.green(`✓ exported ${s.bundleName}`));
  lines.push(`  ${s.artifactPath}`);
  lines.push(`  ${formatBytes(s.size)}  sha256:${s.sha256.slice(0, 12)}…`);
  lines.push("");
  if (s.embeddedSkills > 0) lines.push(`  skills embedded: ${s.embeddedSkills}`);
  if (s.remoteKnowledgeCount > 0) {
    lines.push(`  remote knowledge sources (recipient will fetch): ${s.remoteKnowledgeCount}`);
  }
  if (s.mcpRequiredCount > 0) {
    lines.push(`  required MCP servers (recipient must have): ${s.mcpRequiredCount}`);
  }
  lines.push("");
  lines.push("To install on a recipient machine:");
  lines.push(`  ${pc.cyan(s.installCommand)}`);
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DirectoryExportSummaryInput {
  bundleName: string;
  outputPath: string;
  filesWritten: string[];
}

export function formatDirectoryExportSummary(s: DirectoryExportSummaryInput): string {
  // Build a concise hint that suggests the next git steps. The user might
  // not be in a git repo; that's fine — the hint is harmless to ignore.
  const parent = s.outputPath.split("/").slice(0, -1).join("/");
  const lines = [
    pc.green(`✓ wrote ${s.filesWritten.length} files to ${s.outputPath}`),
    "",
    "next:",
    `  cd ${parent} && git add ${s.bundleName} && git commit -m "Add ${s.bundleName} agent"`,
  ];
  return lines.join("\n");
}
