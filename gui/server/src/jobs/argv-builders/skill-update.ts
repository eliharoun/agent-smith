import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name?: string | undefined;
  all: boolean;
}

export function buildSkillUpdate(req: Req): BuiltArgv {
  if (Boolean(req.name) === req.all) {
    throw new Error("skill.update: provide exactly one of name or all");
  }
  const argv = ["skill", "update"];
  if (req.name) argv.push(req.name);
  if (req.all) argv.push("--all");
  const lockKeys = req.all ? ["global:skills"] : [`skill:${req.name}`, "global:skills"];
  return { argv, lockKeys, preview: previewOf(argv) };
}
