import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
  platforms: string[];
  /** Task 1.5: forward to the CLI's `--force` flag (manifest hash-mismatch bypass). */
  force?: boolean | undefined;
}

export function buildAgentUninstall(req: Req): BuiltArgv {
  const argv = ["agent", "uninstall", req.name, "--yes", "--platforms", req.platforms.join(",")];
  if (req.force) argv.push("--force");
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
