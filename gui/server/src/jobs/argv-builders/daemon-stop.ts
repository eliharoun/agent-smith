import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildDaemonStop(): BuiltArgv {
  const argv = ["daemon", "stop"];
  return { argv, lockKeys: ["daemon"], preview: previewOf(argv) };
}
