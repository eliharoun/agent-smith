import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  agent: string;
  source?: string | undefined;
}

export function buildKnowledgeFetch(req: Req): BuiltArgv {
  const argv = ["knowledge", "fetch", req.agent];
  if (req.source) argv.push("--source", req.source);
  // fetch delegates to `smith agent install <agent>` — lock the agent.
  return {
    argv,
    lockKeys: [`knowledge:${req.agent}`, `agent:${req.agent}`],
    preview: previewOf(argv),
  };
}
