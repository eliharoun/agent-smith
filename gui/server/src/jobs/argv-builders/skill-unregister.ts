import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  pathOrLabel: string;
}

export function buildSkillUnregister(req: Req): BuiltArgv {
  const argv = ["skill", "unregister", req.pathOrLabel];
  return { argv, lockKeys: ["global:skills"], preview: previewOf(argv) };
}
