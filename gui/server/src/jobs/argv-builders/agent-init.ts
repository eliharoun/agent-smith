import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
  description: string;
  template?: string | undefined;
}

export function buildAgentInit(req: Req): BuiltArgv {
  const argv = ["agent", "init", req.name, "--description", req.description];
  if (req.template) argv.push("--template", req.template);
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
