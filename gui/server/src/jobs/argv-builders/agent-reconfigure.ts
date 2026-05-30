import type { Platform } from "gui-shared";
import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
  grant?: Platform[];
  revoke?: Platform[];
}

export function buildAgentReconfigure(req: Req): BuiltArgv {
  const argv = ["agent", "reconfigure", req.name];
  if (req.grant && req.grant.length > 0) {
    argv.push("--grant", req.grant.join(","));
  }
  if (req.revoke && req.revoke.length > 0) {
    argv.push("--revoke", req.revoke.join(","));
  }
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
