import { randomUUID } from "node:crypto";
import type { JobCommand } from "gui-shared";
import type { JobHistoryWriter, JobOutputSink } from "./job-history";
import type { JobEvent, JobRecord } from "./job-types";
import { LockManager } from "./lock-manager";
import { SseBroker } from "./sse-broker";

export interface SpawnHandlers {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  onExit(code: number): void;
}

export interface SpawnHandle {
  stop(): void;
  writeStdin(text: string): void;
}

/**
 * Extra spawner options (currently env-only). Pass `env` to merge extra
 * vars on top of `process.env`; the spawner is responsible for the merge.
 */
export interface SpawnerOptions {
  env?: Record<string, string>;
}

export type Spawner = (
  argv: string[],
  handlers: SpawnHandlers,
  opts?: SpawnerOptions,
) => SpawnHandle;

export interface StartParams {
  command: JobCommand;
  argv: string[];
  preview: string;
  lockKeys: string[];
  /** Extra env vars forwarded to the spawner (e.g. SMITH_PULL_INTERVAL_MS). */
  envOverrides?: Record<string, string>;
}

export interface StartResult {
  id: string;
  preview: string;
}

export interface JobManagerOptions {
  spawner: Spawner;
  maxJobs?: number;
  history?: JobHistoryWriter;
}

export class JobManager {
  readonly broker = new SseBroker();
  readonly locks = new LockManager();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly handles = new Map<string, SpawnHandle>();
  private readonly waiters = new Map<string, Promise<void>>();
  private readonly waitResolvers = new Map<string, () => void>();
  private readonly maxJobs: number;
  private readonly spawner: Spawner;
  private readonly history?: JobHistoryWriter;

  constructor(opts: JobManagerOptions) {
    this.spawner = opts.spawner;
    this.maxJobs = opts.maxJobs ?? 50;
    if (opts.history) this.history = opts.history;
  }

  start(params: StartParams): StartResult {
    if (params.lockKeys.length > 0) {
      const id = randomUUID();
      const ok = this.locks.tryAcquireMany(params.lockKeys, id);
      if (!ok) {
        const held = params.lockKeys.find((k) => this.locks.holderOf(k));
        throw new Error(`resource locked: ${held}`);
      }
      return this.spawn(id, params);
    }
    return this.spawn(randomUUID(), params);
  }

  private spawn(id: string, params: StartParams): StartResult {
    const record: JobRecord = {
      id,
      command: params.command,
      argv: params.argv,
      preview: params.preview,
      status: "running",
      startedAt: Date.now(),
    };
    this.jobs.set(id, record);
    this.evictIfNeeded();

    const waitPromise = new Promise<void>((resolve) => {
      this.waitResolvers.set(id, resolve);
    });
    this.waiters.set(id, waitPromise);

    const sinkPromise: Promise<JobOutputSink | null> = this.history
      ? this.history.beginJob(id).catch((err) => {
          console.warn(`[job-manager] history.beginJob failed for ${id}:`, err);
          return null;
        })
      : Promise.resolve(null);

    const writeToHistory = (chunk: string) => {
      void sinkPromise.then((s) => s?.writeChunk(chunk));
    };

    const outputLines: string[] = [];

    const handle = this.spawner(
      params.argv,
      {
        onStdout: (chunk) => {
          this.publish(id, { type: "stdout", chunk });
          writeToHistory(chunk);
          for (const line of chunk.split("\n")) {
            if (line.length > 0) outputLines.push(line);
          }
        },
        onStderr: (chunk) => {
          this.publish(id, { type: "stderr", chunk });
          writeToHistory(chunk);
          for (const line of chunk.split("\n")) {
            if (line.length > 0) outputLines.push(line);
          }
        },
        onExit: (code) => {
          // Defer to microtask so synchronous spawners (used in tests) don't
          // release locks before `start()` returns. Real Bun.spawn fires onExit
          // asynchronously already; this only matters for fake spawners.
          queueMicrotask(() => {
            record.endedAt = Date.now();
            record.exitCode = code;
            record.status = code === 0 ? "succeeded" : "failed";
            this.publish(id, {
              type: "exit",
              code,
              durationMs: record.endedAt - record.startedAt,
            });
            this.locks.release(id);
            const resolve = this.waitResolvers.get(id);
            if (resolve) {
              resolve();
              this.waitResolvers.delete(id);
            }
            if (this.history) {
              const WARNING_PREFIXES = ["warn ", "warn: ", "⚠"];
              const warnings =
                code === 0
                  ? outputLines
                      .filter((line) =>
                        WARNING_PREFIXES.some((p) => line.toLowerCase().includes(p)),
                      )
                      .slice(0, 10)
                  : undefined;
              const degraded = warnings && warnings.length > 0 ? true : undefined;
              const history = this.history;
              void sinkPromise
                .then((s) => s?.close())
                .then(() =>
                  history.finalize({
                    id,
                    command: params.command,
                    argvPreview: params.preview,
                    startedAt: record.startedAt,
                    endedAt: record.endedAt!,
                    exitCode: code,
                    ...(degraded !== undefined ? { degraded } : {}),
                    ...(warnings !== undefined ? { warnings } : {}),
                  }),
                )
                .catch((err) =>
                  console.warn(`[job-manager] history finalize failed for ${id}:`, err),
                );
            }
          });
        },
      },
      params.envOverrides ? { env: params.envOverrides } : undefined,
    );
    this.handles.set(id, handle);
    return { id, preview: params.preview };
  }

  private publish(id: string, event: JobEvent) {
    this.broker.publish(id, event);
  }

  private evictIfNeeded() {
    if (this.jobs.size <= this.maxJobs) return;
    const sorted = [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
    const drop = sorted.slice(0, this.jobs.size - this.maxJobs);
    for (const r of drop) {
      r.status = "evicted";
      // Stop the spawned subprocess (if still running) so it doesn't outlive
      // its job record. Defensive: handle may be missing if already cleaned up.
      const handle = this.handles.get(r.id);
      if (handle) {
        try {
          handle.stop();
        } catch (err) {
          console.warn(`[job-manager] stop() for evicted job ${r.id} threw:`, err);
        }
      }
      // Release any locks held by this job. LockManager.release is idempotent,
      // so it's safe even if the spawner's onExit also fires later.
      this.locks.release(r.id);
      // Resolve any pending waitForExit() callers so they don't hang forever.
      const resolve = this.waitResolvers.get(r.id);
      if (resolve) {
        resolve();
        this.waitResolvers.delete(r.id);
      }
      this.broker.close(r.id);
      this.handles.delete(r.id);
    }
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  waitForExit(id: string): Promise<void> {
    return this.waiters.get(id) ?? Promise.resolve();
  }

  respond(id: string, answer: string): void {
    const h = this.handles.get(id);
    if (!h) throw new Error(`job ${id} not found`);
    h.writeStdin(`${answer}\n`);
  }
}
