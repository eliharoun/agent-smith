import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  path?: string | undefined;
}

export function buildKnowledgeMigrateCodex(req: Req): BuiltArgv {
  const argv = ["knowledge", "migrate-codex"];
  if (req.path) argv.push("--path", req.path);
  return { argv, lockKeys: ["workspace"], preview: previewOf(argv) };
}
