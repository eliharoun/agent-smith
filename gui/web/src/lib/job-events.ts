export type JobEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "progress"; phase: string; platform?: string; pct?: number }
  | { type: "prompt"; id: string; question: string }
  | { type: "exit"; code: number; durationMs: number };
