import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  path: string;
  kind: "user-global" | "user-local" | "team-shared";
  label?: string | undefined;
  gitRemote?: string | undefined;
  allowEmpty: boolean;
  skipGitCheck: boolean;
}

export function buildSkillRegister(req: Req): BuiltArgv {
  const argv = ["skill", "register", req.path, "--kind", req.kind];
  if (req.label) argv.push("--label", req.label);
  if (req.gitRemote) argv.push("--git-remote", req.gitRemote);
  if (req.allowEmpty) argv.push("--allow-empty");
  if (req.skipGitCheck) argv.push("--skip-git-check");
  return { argv, lockKeys: ["global:skills"], preview: previewOf(argv) };
}
