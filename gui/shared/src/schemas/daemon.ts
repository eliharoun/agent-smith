import { z } from "zod";

/**
 * Lifecycle state of the smith background daemon.
 *
 * - `not-running`  — no pidfile.
 * - `stale-pid`    — pidfile exists but the process is gone (no signal 0
 *                    response). UI should offer to clean up.
 * - `running`      — pidfile + live process. `heartbeatAgeMs` is null when
 *                    the heartbeat file is missing (fresh start) or the
 *                    age can't be computed; a number otherwise.
 * - `stuck`        — process alive but heartbeat older than
 *                    `heartbeatStaleMs` (7s). UI should offer to restart.
 */
export const DaemonStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-running") }),
  z.object({ state: z.literal("stale-pid"), pid: z.number().int().positive() }),
  z.object({
    state: z.literal("running"),
    pid: z.number().int().positive(),
    heartbeatAgeMs: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    state: z.literal("stuck"),
    pid: z.number().int().positive(),
    heartbeatAgeMs: z.number().int().nonnegative(),
  }),
]);
export type DaemonStatus = z.infer<typeof DaemonStatus>;

/**
 * Tunables read by `smith daemon run` at src/index.ts:614-615. Both are
 * optional — undefined means "use the CLI's compiled-in default". The
 * GUI persists these to .env via `services/smith-env.ts` and may also
 * pass them as `envOverrides` on a daemon.start JobRequest for a single
 * restart cycle.
 */
export const SmithEnv = z.object({
  pullIntervalMs: z.number().int().positive().optional(),
  heartbeatIntervalMs: z.number().int().positive().optional(),
});
export type SmithEnv = z.infer<typeof SmithEnv>;
