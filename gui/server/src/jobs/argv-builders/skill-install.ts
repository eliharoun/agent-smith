import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name?: string | undefined;
  from?: string | undefined;
  as?: string | undefined;
  targets: string[];
  // C4.2.5: external-repo install ref. CLI flag is `--git-ref` (note the
  // asymmetry with agent install which uses `--ref`).
  ref?: string | undefined;
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
  if (req.targets.length > 0) argv.push("--targets", req.targets.join(","));
  // Lock key: when installing by name we lock skill:<name>; when installing
  // by path we don't yet know the resolved name, so lock global:skills only.
  const lockKeys = req.name ? [`skill:${req.name}`, "global:skills"] : ["global:skills"];
  return { argv, lockKeys, preview: previewOf(argv) };
}
