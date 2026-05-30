import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  agent: string;
  json: boolean;
}

export function buildKnowledgeList(req: Req): BuiltArgv {
  const argv = ["knowledge", "list", req.agent];
  if (req.json) argv.push("--json");
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
