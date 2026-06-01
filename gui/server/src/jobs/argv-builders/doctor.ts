import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  json?: boolean | undefined;
  fixKnowledgeRefresh?: boolean | undefined;
  fixKnowledgeCompile?: boolean | undefined;
}

export function buildDoctor(req: Req): BuiltArgv {
  const argv = ["doctor"];
  if (req.json) argv.push("--json");
  if (req.fixKnowledgeRefresh) argv.push("--fix-knowledge-refresh");
  if (req.fixKnowledgeCompile) argv.push("--fix-knowledge-compile");
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
