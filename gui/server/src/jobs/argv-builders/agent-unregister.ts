import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  pathOrLabel: string;
}

export function buildAgentUnregister(req: Req): BuiltArgv {
  const argv = ["agent", "unregister", req.pathOrLabel];
  return { argv, lockKeys: ["global:catalogs"], preview: previewOf(argv) };
}
