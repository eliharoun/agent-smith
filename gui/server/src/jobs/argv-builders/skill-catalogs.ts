import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildSkillCatalogs(): BuiltArgv {
  const argv = ["skill", "catalogs"];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
