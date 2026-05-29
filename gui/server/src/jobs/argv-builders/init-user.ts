import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildInitUser(): BuiltArgv {
  const argv = ["init-user"];
  return { argv, lockKeys: ["global:init"], preview: previewOf(argv) };
}
