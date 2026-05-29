import { z } from "zod";
import { JobRequest } from "./jobs";

// Derive the literal union of command tags from JobRequest so adding a new
// variant in jobs.ts doesn't require touching this file. zod 4 exposes
// `.options` on a discriminatedUnion as the tuple of member schemas; refined
// objects still expose `.shape.command.value` on their inner ZodObject.
const JobCommand = z.enum(
  JobRequest.options.map(
    (o) => (o as unknown as { shape: { command: { value: string } } }).shape.command.value,
  ) as [string, ...string[]],
);

export const JobHistoryEntry = z.object({
  id: z.string().min(1),
  command: JobCommand,
  argvPreview: z.string(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  outputAvailable: z.boolean(),
  degraded: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
});
export type JobHistoryEntry = z.infer<typeof JobHistoryEntry>;

export const JobHistorySearchHit = z.object({
  jobId: z.string().min(1),
  lineNumber: z.number().int().positive(),
  matchedLine: z.string(),
  contextBefore: z.array(z.string()).optional(),
  contextAfter: z.array(z.string()).optional(),
});
export type JobHistorySearchHit = z.infer<typeof JobHistorySearchHit>;
