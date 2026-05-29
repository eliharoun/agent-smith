import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  oldLabel: string;
  newLabel: string;
}

export function buildSkillCatalogRename(req: Req): BuiltArgv {
  const argv = ["skill", "catalog", "rename", req.oldLabel, req.newLabel];
  return {
    argv,
    lockKeys: [`catalog:${req.oldLabel}`, `catalog:${req.newLabel}`, "global:skills"],
    preview: previewOf(argv),
  };
}
