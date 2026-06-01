import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name?: string | undefined;
  all?: boolean | undefined;
}

/**
 * T11: `smith knowledge compile [name] [--all]`. Builds the per-bundle
 * progressive-compile manifest + BM25 index files. The CLI rejects
 * "neither name nor --all" and "both name and --all" itself with usage
 * errors, so the GUI doesn't refine those — we just pick a deterministic
 * argv shape (`--all` wins when both are set, mirroring how a user would
 * recover after seeing the CLI error). Locking is bundle-scoped when a
 * name is given so concurrent compile/serve/fetch calls on the same
 * bundle serialize; `--all` takes a workspace-level lock to prevent two
 * GUI tabs from racing the whole catalog.
 */
export function buildKnowledgeCompile(req: Req): BuiltArgv {
  const argv = ["knowledge", "compile"];
  if (req.all) argv.push("--all");
  else if (req.name) argv.push(req.name);
  const lockKeys = req.all ? ["workspace"] : req.name ? [`knowledge:${req.name}`] : [];
  return { argv, lockKeys, preview: previewOf(argv) };
}
