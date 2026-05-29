import type { JobCommand } from "gui-shared";

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "evicted";

export interface JobRecord {
  id: string;
  command: JobCommand;
  argv: string[];
  preview: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
}

export type JobEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "progress"; phase: string; platform?: string; pct?: number }
  | { type: "prompt"; id: string; question: string }
  | { type: "exit"; code: number; durationMs: number };
