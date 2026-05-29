import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  oldLabel: string;
  newLabel: string;
}

export function buildAgentCatalogRename(req: Req): BuiltArgv {
  const argv = ["agent", "catalog", "rename", req.oldLabel, req.newLabel];
  return {
    argv,
    lockKeys: [`catalog:${req.oldLabel}`, `catalog:${req.newLabel}`, "global:catalogs"],
    preview: previewOf(argv),
  };
}
