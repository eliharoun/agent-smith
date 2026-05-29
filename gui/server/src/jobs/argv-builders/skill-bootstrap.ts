import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  dryRun: boolean;
  targets: string[];
}

export function buildSkillBootstrap(req: Req): BuiltArgv {
  const argv = ["skill", "bootstrap"];
  if (req.dryRun) argv.push("--dry-run");
  if (req.targets.length > 0) argv.push("--targets", req.targets.join(","));
  return { argv, lockKeys: ["global:skills"], preview: previewOf(argv) };
}
