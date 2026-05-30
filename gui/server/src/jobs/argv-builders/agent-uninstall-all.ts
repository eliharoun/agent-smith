import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  platforms: string[];
  /** Task 1.5: forward to the CLI's `--force` flag. */
  force?: boolean | undefined;
}

export function buildAgentUninstallAll(req: Req): BuiltArgv {
  const argv = ["agent", "uninstall-all", "--yes", "--platforms", req.platforms.join(",")];
  if (req.force) argv.push("--force");
  return { argv, lockKeys: ["global:agents"], preview: previewOf(argv) };
}
