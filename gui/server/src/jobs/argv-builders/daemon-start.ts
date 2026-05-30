import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  envOverrides?: Record<string, string> | undefined;
}

export function buildDaemonStart(req: Req): BuiltArgv {
  const argv = ["daemon", "start"];
  const out: BuiltArgv = {
    argv,
    lockKeys: ["daemon"],
    preview: previewOf(argv),
  };
  if (req.envOverrides) out.envOverrides = req.envOverrides;
  return out;
}
