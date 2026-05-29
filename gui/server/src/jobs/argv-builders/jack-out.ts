import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  confirmPhrase: string;
}

/**
 * Build argv for `smith jack-out --yes`. This is the most destructive
 * operation in the GUI; the confirm-phrase check below is defense in
 * depth — the schema already requires `confirmPhrase === "jack-out"`,
 * but a malformed payload that slipped past the validator middleware
 * would still be rejected here. Locks all three resources (workspace,
 * daemon, all-agents) to block any concurrent ops during teardown.
 */
export function buildJackOut(req: Req): BuiltArgv {
  if (req.confirmPhrase !== "jack-out") {
    throw new Error('confirmPhrase must equal "jack-out"');
  }
  const argv = ["jack-out", "--yes"];
  return {
    argv,
    lockKeys: ["workspace", "daemon", "all-agents"],
    preview: previewOf(argv),
  };
}
