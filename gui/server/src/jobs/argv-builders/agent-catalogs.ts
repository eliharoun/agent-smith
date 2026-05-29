import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildAgentCatalogs(): BuiltArgv {
  const argv = ["agent", "catalogs"];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
