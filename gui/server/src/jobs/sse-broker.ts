import type { JobEvent } from "./job-types";

type Listener = (ev: JobEvent) => void;

export interface SseBrokerOptions {
  maxBuffer?: number;
}

export class SseBroker {
  private readonly buffers = new Map<string, JobEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly maxBuffer: number;

  constructor(opts: SseBrokerOptions = {}) {
    this.maxBuffer = opts.maxBuffer ?? 10_000;
  }

  publish(jobId: string, event: JobEvent): void {
    const buf = this.buffers.get(jobId) ?? [];
    buf.push(event);
    while (buf.length > this.maxBuffer) buf.shift();
    this.buffers.set(jobId, buf);
    const set = this.listeners.get(jobId);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(event);
        } catch (err) {
          console.warn(`[sse-broker] listener for ${jobId} threw:`, err);
        }
      }
    }
  }

  subscribe(jobId: string, fn: Listener): () => void {
    const buf = this.buffers.get(jobId) ?? [];
    for (const ev of buf) fn(ev);
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(fn);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(fn);
    };
  }

  close(jobId: string): void {
    this.listeners.delete(jobId);
    this.buffers.delete(jobId);
  }

  static format(event: JobEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }
}
