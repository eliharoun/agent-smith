// gui/server/src/jobs/argv-builders/agent-sync.ts
//
// C4.2.6 (v1-task): builder for the agent.sync JobRequest. Maps to the
// CLI's `smith agent sync <name>` which fast-forwards the cloned remote
// catalog and refreshes the registry's lastPulledSha. The CLI takes a
// per-clone filesystem lock via withFileLock; we add a coarse-grained
// agent:<name> lock so two GUI tabs syncing the same agent serialize.

import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

export function buildAgentSync(req: Req): BuiltArgv {
  const argv = ["agent", "sync", req.name];
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
