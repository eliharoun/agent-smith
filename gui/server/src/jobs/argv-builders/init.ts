import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

export function buildInit(): BuiltArgv {
  const argv = ["init"];
  return { argv, lockKeys: ["global:init"], preview: previewOf(argv) };
}
