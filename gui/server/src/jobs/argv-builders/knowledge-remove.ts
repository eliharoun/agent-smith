import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  agent: string;
  sourceId: string;
}

export function buildKnowledgeRemove(req: Req): BuiltArgv {
  const argv = ["knowledge", "remove", req.agent, req.sourceId];
  // remove is a config-only edit; no auto-materialize. Lock knowledge only.
  return {
    argv,
    lockKeys: [`knowledge:${req.agent}`],
    preview: previewOf(argv),
  };
}
