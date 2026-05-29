// Map daemon state classifications onto Lamp status colors. Used by
// TopBar and StatStrip so the lamp always agrees with the four-state
// daemon classification produced by readDaemonStatus(). Through rc.2
// the top-bar lamp consumed a flat boolean from /api/status while
// DaemonControl consumed the rich four-state response from
// /api/daemon/status — when the daemon was "stuck" (alive but
// heartbeat stale), the top bar showed green while the panel showed
// amber. rc.3 unifies on the four-state response everywhere.

import type { DaemonStatus } from "gui-shared";

export type LampStatus = "on" | "warn" | "off" | "error";

export function daemonStateToLampStatus(state: DaemonStatus["state"] | undefined): LampStatus {
  switch (state) {
    case "running":
      return "on";
    case "stuck":
    case "stale-pid":
      return "warn";
    case "not-running":
      return "off";
    default:
      // Undefined while loading — show off (grey) rather than green.
      return "off";
  }
}
