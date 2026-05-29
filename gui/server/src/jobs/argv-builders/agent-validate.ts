import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

export function buildAgentValidate(req: Req): BuiltArgv {
  const argv = ["agent", "validate", req.name];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
