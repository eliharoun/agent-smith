import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildStatus(): BuiltArgv {
  const argv = ["status"];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
