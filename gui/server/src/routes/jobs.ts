import { JobRequest } from "gui-shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildArgv } from "../jobs/argv-builders";
import type { JobManager } from "../jobs/job-manager";
import { SseBroker } from "../jobs/sse-broker";
import { HttpError } from "../middleware/error";

export function registerJobsRoutes(app: Hono, jobs: JobManager) {
  app.post("/api/jobs", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = JobRequest.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    const built = buildArgv(parsed.data);
    try {
      const started = jobs.start({
        command: parsed.data.command,
        argv: built.argv,
        preview: built.preview,
        lockKeys: built.lockKeys,
        ...(built.envOverrides ? { envOverrides: built.envOverrides } : {}),
      });
      return c.json({ jobId: started.id, preview: started.preview }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "start failed";
      if (msg.startsWith("resource locked")) {
        throw new HttpError(409, "LOCKED", msg);
      }
      throw err;
    }
  });

  app.get("/api/jobs/:id", (c) => {
    const id = c.req.param("id");
    const job = jobs.get(id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "job not found");
    return c.json(job);
  });

  app.get("/api/jobs/:id/stream", (c) => {
    const id = c.req.param("id");
    if (!jobs.get(id)) throw new HttpError(404, "NOT_FOUND", "job not found");
    return streamSSE(c, async (s) => {
      // Declared up-front so onAbort can reference before subscribe assigns.
      let unsub: () => void = () => {};
      s.onAbort(() => unsub());
      await s.write(`retry: 5000\n\n`);
      unsub = jobs.broker.subscribe(id, async (ev) => {
        await s.write(SseBroker.format(ev));
        if (ev.type === "exit") {
          unsub();
          await s.close();
        }
      });
      // keep the response open until aborted
      await new Promise(() => {});
    });
  });

  app.post("/api/jobs/:id/respond", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { answer?: string } | null;
    if (!body?.answer) throw new HttpError(400, "BAD_REQUEST", "answer required");
    jobs.respond(id, body.answer);
    return c.json({ ok: true });
  });
}
