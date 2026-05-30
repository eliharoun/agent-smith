import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  agent?: string | undefined;
}

export function buildKnowledgeValidate(req: Req): BuiltArgv {
  const argv = ["knowledge", "validate"];
  if (req.agent) argv.push(req.agent);
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
