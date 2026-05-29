import type { JobRequest } from "gui-shared";
import { buildArgv } from "../../../server/src/jobs/argv-builders";

export function previewFor(req: JobRequest): string {
  try {
    return buildArgv(req).preview;
  } catch {
    return "smith …";
  }
}
