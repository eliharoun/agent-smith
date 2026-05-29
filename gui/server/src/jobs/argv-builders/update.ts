import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  dryRun: boolean;
}

export function buildUpdate(req: Req): BuiltArgv {
  const argv = ["update"];
  if (req.dryRun) argv.push("--dry-run");
  return { argv, lockKeys: ["workspace"], preview: previewOf(argv) };
}
