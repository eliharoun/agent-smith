import type { FieldHelpEntry } from "./index";

/**
 * Help text for the daemon-tuning env form (SmithEnvForm).
 *
 * Both fields share copy that explains the purpose + the "restart required"
 * caveat — the form already surfaces the restart action inline, but the
 * tooltip makes the cause/effect explicit.
 */
export const daemonHelp: Record<string, FieldHelpEntry> = {
  "daemon.pullInterval": {
    help: "Daemon-tuning knob. ms between background git pulls of registered catalogs. Saving requires a daemon restart to take effect.",
  },
  "daemon.heartbeatInterval": {
    help: "Daemon-tuning knob. ms between liveness writes. Saving requires a daemon restart to take effect.",
  },
};
