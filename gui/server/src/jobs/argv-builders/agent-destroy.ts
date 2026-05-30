import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  name: string;
  confirmName: string;
  /**
   * When true, append `--force` so the CLI chains uninstall + destroy under
   * the same `agent:<name>` lock. Required when the agent is currently
   * installed on at least one platform — the CLI rejects bare destroy in
   * that case to prevent orphan editor-config entries pointing at a
   * deleted source bundle. See `src/cli/commands/destroy-agent.ts` for the
   * authoritative guard.
   */
  force?: boolean | undefined;
}

export function buildAgentDestroy(req: Req): BuiltArgv {
  if (req.confirmName !== req.name) {
    throw new Error("confirmName mismatch");
  }
  const argv = ["agent", "destroy", req.name, "--yes"];
  if (req.force) argv.push("--force");
  return { argv, lockKeys: [`agent:${req.name}`], preview: previewOf(argv) };
}
