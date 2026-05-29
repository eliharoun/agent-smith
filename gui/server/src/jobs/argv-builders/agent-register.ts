import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  path: string;
  kind: "user-global" | "project" | "registered";
  label?: string | undefined;
  gitRemote?: string | undefined;
  allowEmpty: boolean;
  skipGitCheck: boolean;
}

export function buildAgentRegister(req: Req): BuiltArgv {
  const argv = ["agent", "register", req.path, "--kind", req.kind];
  if (req.label) argv.push("--label", req.label);
  if (req.gitRemote) argv.push("--git-remote", req.gitRemote);
  if (req.allowEmpty) argv.push("--allow-empty");
  if (req.skipGitCheck) argv.push("--skip-git-check");
  return { argv, lockKeys: ["global:catalogs"], preview: previewOf(argv) };
}
