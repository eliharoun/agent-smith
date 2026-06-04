import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
  to: string;
  includeSkills: boolean;
  userMd: "stub" | "keep" | "reject";
  compression: "gzip" | "none";
  json: boolean;
  dryRun: boolean;
  stdout: boolean;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export function buildAgentExport(req: Req): BuiltArgv {
  if (!SAFE_NAME.test(req.name)) {
    throw new Error(`agent.export: invalid agent name '${req.name}'`);
  }
  if (req.stdout && req.to !== ".") {
    throw new Error("agent.export: --stdout and --to are mutually exclusive");
  }
  const argv: string[] = ["agent", "export", req.name];
  if (req.stdout) argv.push("--stdout");
  else argv.push("--to", req.to);
  if (req.compression !== "gzip") argv.push("--compression", req.compression);
  if (!req.includeSkills) argv.push("--no-include-skills");
  argv.push("--user-md", req.userMd);
  if (req.json) argv.push("--json");
  if (req.dryRun) argv.push("--dry-run");
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
