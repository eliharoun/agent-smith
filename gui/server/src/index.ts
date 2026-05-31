import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createBunSpawner } from "./jobs/bun-spawner";
import { createJobHistoryWriter } from "./jobs/job-history";
import { JobManager, type Spawner } from "./jobs/job-manager";
import { defaultGuiJobsPaths } from "./services/cache-paths";
import { smithBinaryPath } from "./services/smith-binary";

const here = dirname(fileURLToPath(import.meta.url));
const builtWebRoot = join(here, "..", "..", "web", "dist");

export interface StartGuiOptions {
  port: number;
  bind: string;
  token: string;
  smithVersion?: string;
}

export interface StartedGui {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Compute a browser-routable host for display URLs.
 *
 * `0.0.0.0` and `::`/`::0` are wildcard bind addresses; most browsers refuse
 * to navigate to them. When the server binds to a wildcard, advertise the
 * loopback address instead so the printed URL is clickable.
 */
export function displayHost(bind: string): string {
  if (bind === "0.0.0.0" || bind === "::" || bind === "::0") {
    return "127.0.0.1";
  }
  return bind;
}

/**
 * Construct the production JobManager with on-disk history wired in. Exposed
 * (spawner + stateRoot injectable) so tests can assert completed jobs persist
 * without binding a port. `startGuiServer` MUST use this — wiring the history
 * writer here is what populates the GUI History page.
 */
export function createGuiJobManager(
  opts: { spawner?: Spawner; stateRoot?: string } = {},
): JobManager {
  const { jsonlPath, outputDir } = defaultGuiJobsPaths(opts.stateRoot);
  return new JobManager({
    spawner: opts.spawner ?? createBunSpawner({ binary: smithBinaryPath() }),
    history: createJobHistoryWriter({ jsonlPath, outputDir }),
  });
}

export async function startGuiServer(opts: StartGuiOptions): Promise<StartedGui> {
  // Construct the JobManager once at the production entry point so the
  // singleton invariant is enforced here rather than relying on createApp
  // being called only once. createApp still falls back to constructing its
  // own JobManager when `jobs` is omitted (used by app tests).
  const jobs = createGuiJobManager();
  // C4.3.2: derive the same-origin allow value from the URL the user will
  // actually navigate to. Thunk form defers reading server.port until after
  // Bun.serve() returns (ephemeral port=0 case).
  let resolvedPort = opts.port;
  const app = createApp({
    token: opts.token,
    jobs,
    staticRoot: builtWebRoot,
    allowedOrigin: () => `http://${displayHost(opts.bind)}:${resolvedPort}`,
    ...(opts.smithVersion !== undefined ? { smithVersion: opts.smithVersion } : {}),
  });
  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bind,
    fetch: app.fetch,
    // Long-running jobs (knowledge.refresh, update, etc.) stream output over
    // SSE for minutes. Bun's default per-connection idleTimeout is 10s, which
    // kills the stream mid-job with "request timed out after 10 seconds."
    // 255s is Bun's max; SSE clients still send keep-alive pings well within
    // that window, so the connection stays alive for the full job duration.
    idleTimeout: 255,
  });
  const actualPort = server.port ?? opts.port;
  resolvedPort = actualPort;
  return {
    port: actualPort,
    url: `http://${displayHost(opts.bind)}:${actualPort}/?token=${opts.token}`,
    stop: async () => {
      server.stop(true);
    },
  };
}
