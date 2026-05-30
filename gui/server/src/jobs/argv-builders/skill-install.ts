import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

interface Req {
  name?: string | undefined;
  from?: string | undefined;
  as?: string | undefined;
  targets: string[];
  ref?: string | undefined;
  skills?: string[] | undefined;
  all?: boolean | undefined;
  json?: boolean | undefined;
}

export function buildSkillInstall(req: Req): BuiltArgv {
  if (Boolean(req.name) === Boolean(req.from)) {
    throw new Error("skill.install: provide exactly one of name or from");
  }
  const argv = ["skill", "install"];
  if (req.name) argv.push(req.name);
  if (req.from) argv.push("--from", req.from);
  if (req.ref) argv.push("--git-ref", req.ref);
  if (req.as) argv.push("--as", req.as);
  if (req.json) argv.push("--json");
  if (req.all) argv.push("--all");
  if (req.skills && req.skills.length > 0) {
    for (const s of req.skills) {
      if (!SAFE_NAME.test(s)) throw new Error(`skill.install: invalid skill name '${s}'`);
    }
    argv.push("--skills", req.skills.join(","));
  }
  if (req.targets.length > 0) argv.push("--targets", req.targets.join(","));
  const lockKeys =
    req.skills && req.skills.length > 0
      ? ["global:skills", ...req.skills.map((s) => `skill:${s}`)]
      : req.name
        ? [`skill:${req.name}`, "global:skills"]
        : ["global:skills"];
  return { argv, lockKeys, preview: previewOf(argv) };
}
