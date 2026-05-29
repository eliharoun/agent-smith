import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
}

export function buildSkillUninstall(req: Req): BuiltArgv {
  const argv = ["skill", "uninstall", req.name];
  return {
    argv,
    lockKeys: [`skill:${req.name}`, "global:skills"],
    preview: previewOf(argv),
  };
}
