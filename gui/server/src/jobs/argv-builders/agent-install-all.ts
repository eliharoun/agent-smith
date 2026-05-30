import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  platforms: string[];
  withSkills: boolean;
  /** Task 1.5: forward to the CLI's `--force` flag. */
  force?: boolean | undefined;
}

export function buildAgentInstallAll(req: Req): BuiltArgv {
  const argv = ["agent", "install-all", "--yes", "--platforms", req.platforms.join(",")];
  if (req.withSkills) argv.push("--with-skills");
  if (req.force) argv.push("--force");
  return { argv, lockKeys: ["global:agents"], preview: previewOf(argv) };
}
