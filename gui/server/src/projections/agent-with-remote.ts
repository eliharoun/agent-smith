// gui/server/src/projections/agent-with-remote.ts
//
// C4.1.3 (v1-task): pure projection that merges a registry remote{} block
// into an AgentSummary. The lookup map is keyed by catalog rootPath and
// built by the wiring step (C4.1.4) from the registry's source list.

import type { AgentSummary } from "../../../shared/src/index";
import { findRemoteForPath, type RemoteLookup } from "./remote-lookup";

export function agentWithRemote(summary: AgentSummary, remotes: RemoteLookup): AgentSummary {
  const remote = findRemoteForPath(summary.path, remotes);
  if (!remote) return summary;
  return { ...summary, remote };
}
