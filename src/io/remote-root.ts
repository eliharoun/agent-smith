// src/io/remote-root.ts
//
// Resolves <xdgStateHome>/remote — the root for cloned external-repo
// catalogs. Pure function; no IO. Honors XDG_STATE_HOME lazily so test env
// mutations are picked up.
//
// Migrated in v1.0.0-rc.2 from $XDG_CONFIG_HOME to $XDG_STATE_HOME (XDG
// Base Directory Specification: state belongs under STATE, not CONFIG).
// This is a BREAKING change: clones at the old location are invisible
// after upgrade. See CHANGELOG and spec §2.

import { join } from "node:path";
import { xdgStateHome } from "./xdg-state-home";

export function defaultRemoteRoot(): string {
  return join(xdgStateHome(), "remote");
}
