import { SmithEnv } from "../../../shared/src/index";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { FileTailBroker } from "../jobs/file-tail-broker";
import { readDaemonStatus } from "../services/daemon-status";
import { readSmithEnv, writeSmithEnv } from "../services/smith-env";

export interface DaemonRouteDeps {
  daemonPidPath: string;
  daemonHeartbeatPath: string;
  daemonLogPath: string;
  smithEnvPath: string;
  /** Test seam: defaults to a process.kill(pid, 0) probe in readDaemonStatus. */
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * `/api/daemon/*` routes:
 *  - `GET    /api/daemon/status`     — classified DaemonStatus
 *  - `GET    /api/daemon/env`        — parsed SmithEnv from .env
 *  - `PUT    /api/daemon/env`        — upsert SmithEnv keys into .env
 *  - `GET    /api/daemon/log/stream` — SSE tail of daemon.log (FileTailBroker)
 */
export function registerDaemonRoute(app: Hono, deps: DaemonRouteDeps): void {
  const broker = new FileTailBroker();

  app.get("/api/daemon/status", async (c) => {
    const status = await readDaemonStatus({
      pidPath: deps.daemonPidPath,
      heartbeatPath: deps.daemonHeartbeatPath,
      ...(deps.isProcessAlive ? { isProcessAlive: deps.isProcessAlive } : {}),
    });
    return c.json(status);
  });

  app.get("/api/daemon/env", async (c) => {
    const env = await readSmithEnv({ envPath: deps.smithEnvPath });
    return c.json(env);
  });

  app.put("/api/daemon/env", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SmithEnv.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid", details: parsed.error.issues }, 400);
    }
    await writeSmithEnv(parsed.data, { envPath: deps.smithEnvPath });
    const after = await readSmithEnv({ envPath: deps.smithEnvPath });
    return c.json(after);
  });

  app.get("/api/daemon/log/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const sub = broker.subscribe(deps.daemonLogPath, { initialLines: 200 });
      stream.onAbort(() => sub.close());
      // Give the async initial-read a chance to settle before draining.
      await new Promise((r) => setTimeout(r, 30));
      for (const line of sub.initial) {
        await stream.writeSSE({ event: "line", data: line });
      }
      try {
        for await (const line of sub.stream) {
          await stream.writeSSE({ event: "line", data: line });
        }
      } catch {
        // Either the broker closed (client disconnect) or the file vanished.
      }
    });
  });
}
