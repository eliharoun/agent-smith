export interface BuiltArgv {
  argv: string[];
  lockKeys: string[];
  preview: string;
  /**
   * Optional extra env vars to merge into the spawned process's
   * environment. Currently used by `daemon.start` to forward
   * `SMITH_PULL_INTERVAL_MS` / `SMITH_HEARTBEAT_INTERVAL_MS` for a
   * single restart. JobManager threads this into the spawner in Task 16.
   */
  envOverrides?: Record<string, string>;
}
export function previewOf(argv: string[]): string {
  return `smith ${argv.join(" ")}`;
}
