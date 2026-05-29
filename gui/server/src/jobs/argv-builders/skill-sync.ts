// gui/server/src/jobs/argv-builders/skill-sync.ts
//
// C4.2.6 (v1-task): builder for the skill.sync JobRequest. Maps to the
// CLI's `smith skill sync <name>` which fast-forwards the cloned remote
// catalog and refreshes the registry's lastPulledSha. Mirrors
// skill-install's dual-lock (skill:<name> + global:skills) so a sync
// serializes against concurrent install / uninstall operations.

import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

export function buildSkillSync(req: Req): BuiltArgv {
  const argv = ["skill", "sync", req.name];
  return {
    argv,
    lockKeys: [`skill:${req.name}`, "global:skills"],
    preview: previewOf(argv),
  };
}
