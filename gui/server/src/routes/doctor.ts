import { DoctorResponse } from "gui-shared";
import type { Hono } from "hono";
import type { JobManager } from "../jobs/job-manager";
import { HttpError } from "../middleware/error";

export function registerDoctorRoute(app: Hono, jobs: JobManager) {
  app.get("/api/doctor", async (c) => {
    const out: string[] = [];
    const job = jobs.start({
      command: "doctor",
      argv: ["doctor", "--json"],
      preview: "smith doctor --json",
      lockKeys: [],
    });
    const unsub = jobs.broker.subscribe(job.id, (ev) => {
      if (ev.type === "stdout") out.push(ev.chunk);
    });
    await jobs.waitForExit(job.id);
    unsub();
    const record = jobs.get(job.id);
    // CLI exit codes: 0 = healthy, 1 = drift, 2 = network-error OR
    // no-platform-detected refusal. Both 1 and 2 are valid responses
    // that ship a JSON payload — only treat truly unexpected failures
    // (no record, missing JSON entirely) as 500.
    if (!record) {
      throw new HttpError(500, "DOCTOR_FAILED", "no job record after exit");
    }
    let json: unknown;
    try {
      json = JSON.parse(out.join(""));
    } catch (err) {
      throw new HttpError(
        500,
        "DOCTOR_PARSE",
        `invalid JSON from smith doctor: ${(err as Error).message}`,
      );
    }
    const parsed = DoctorResponse.safeParse(json);
    if (!parsed.success) {
      throw new HttpError(500, "DOCTOR_PARSE", parsed.error.message);
    }
    return c.json(parsed.data);
  });
}
