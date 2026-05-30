import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  all: boolean;
}

export function buildSkillList(req: Req): BuiltArgv {
  const argv = ["skill", "list"];
  if (req.all) argv.push("--all");
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
