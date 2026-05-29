import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

export function buildSkillValidate(req: Req): BuiltArgv {
  const argv = ["skill", "validate", req.name];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
