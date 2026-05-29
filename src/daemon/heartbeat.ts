// src/daemon/heartbeat.ts
//
// Heartbeat writer. The daemon rewrites a single JSON file every few seconds
// with its pid, start time, last-beat time, and a snapshot of per-source
// pull state. The file is the operator's "is the daemon healthy?" signal,
// consumed by `daemon status` and external monitors.
//
// Writes are atomic (write to a unique temp file in the same directory,
// then rename onto the final path). Concurrent readers therefore never see
// a torn / half-written JSON document.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeStateHome } from "../io/runtime-state-home";
import type { HeartbeatSnapshot } from "./index";

/**
 * Absolute path to the heartbeat file. Resolved lazily per call so
 * `XDG_STATE_HOME` mutations (notably in tests) are honored without
 * cached module-load-time state.
 */
export function heartbeatPath(): string {
  return join(runtimeStateHome(), "daemon.heartbeat.json");
}

/**
 * Default writer: serializes snapshot to JSON, writes to a unique temp file,
 * then renames onto heartbeatPath(). Same-directory rename is atomic on POSIX
 * filesystems, which is what we get on macOS / Linux.
 */
export async function defaultWriteHeartbeat(snapshot: HeartbeatSnapshot): Promise<void> {
  const target = heartbeatPath();
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  // Suffix with pid+random so concurrent daemon starts (which shouldn't
  // happen, but defense-in-depth) don't clobber each other's tempfiles.
  const tmp = `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf-8");
  await rename(tmp, target);
}

/** Default remover: best-effort delete of the heartbeat file. */
export async function defaultRemoveHeartbeat(): Promise<void> {
  await rm(heartbeatPath(), { force: true });
}

/**
 * Read a heartbeat file and return the parsed snapshot, or null if the
 * file does not exist or cannot be parsed.
 *
 * B11.4 migration: legacy on-disk snapshots (pre-v0.24.0) lacked the
 * `schemaVersion` field. The reader injects `schemaVersion: 1` when the
 * field is missing, normalizing the in-memory shape so callers always
 * see a current-version snapshot. Migration is lazy (in-memory only) —
 * the daemon's next heartbeat tick writes the new shape naturally.
 *
 * Exported for tests and CLI consumers. The cli/commands/daemon.ts
 * status path uses its own inline parser; both produce identical
 * snapshots.
 */
export async function readHeartbeatFromPath(path: string): Promise<HeartbeatSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  // B11.4 migration: inject schemaVersion: 1 if missing (legacy file).
  // Explicit non-1 values fall through and produce a snapshot with the
  // wrong type — callers can detect this via schemaVersion.
  if (!("schemaVersion" in obj)) {
    obj.schemaVersion = 1;
  }
  // D.1 migration: inject status: "ready" if missing (v1 file).
  if (!("status" in obj)) {
    obj.status = "ready";
  }
  return obj as unknown as HeartbeatSnapshot;
}
