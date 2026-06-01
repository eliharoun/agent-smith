import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

/**
 * T11: `smith knowledge serve <name> --stdio`. The CLI currently only
 * supports stdio transport (it errors otherwise — see
 * `src/cli/commands/knowledge/serve.ts`); we hard-wire `--stdio` so the
 * GUI never has to deal with the not-yet-implemented HTTP/SSE transport.
 *
 * Lock is bundle-scoped: serve and compile both touch the BM25 index
 * file, so two concurrent jobs on the same bundle would race. The GUI's
 * job-stop endpoint cancels the long-running serve process when the user
 * toggles it off (or navigates away).
 */
export function buildKnowledgeServe(req: Req): BuiltArgv {
  const argv = ["knowledge", "serve", req.name, "--stdio"];
  return { argv, lockKeys: [`knowledge:${req.name}`], preview: previewOf(argv) };
}
