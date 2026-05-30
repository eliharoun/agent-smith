import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildAgentList(): BuiltArgv {
  const argv = ["agent", "list"];
  return { argv, lockKeys: [], preview: previewOf(argv) };
}
