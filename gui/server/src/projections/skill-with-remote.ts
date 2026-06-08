// gui/server/src/projections/skill-with-remote.ts
//
// C4.1.3 (v1-task): pure projection that merges a registry remote{} block
// into a SkillSummary. Same longest-prefix lookup as agentWithRemote;
// each skill catalog can contain many skills, and they all share the
// catalog's remote block.

import type { SkillSummary } from "../../../shared/src/index";
import { findRemoteForPath, type RemoteLookup } from "./remote-lookup";

export function skillWithRemote(summary: SkillSummary, remotes: RemoteLookup): SkillSummary {
  const remote = findRemoteForPath(summary.path, remotes);
  if (!remote) return summary;
  return { ...summary, remote };
}
