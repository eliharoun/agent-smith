import { type FSWatcher, watch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

export interface FileTailSubscription {
  /** Lines already on disk at subscribe time (oldest first). */
  initial: string[];
  /** Async iterator over new lines as they're appended. */
  stream: AsyncIterable<string>;
  /** Tear down watchers and resolve the iterator. */
  close(): void;
}

interface SubscriptionInternals {
  closed: boolean;
  pending: string[];
  waiter: ((v: IteratorResult<string>) => void) | null;
}

/**
 * Tail-follow append-only files over an async iterator. Distinct from the
 * job-scoped `SseBroker`: that one is in-memory event fan-out; this one
 * follows on-disk log files (e.g. daemon heartbeat log) and survives
 * server restarts.
 *
 * Implementation notes:
 *  - initial: reverse-read in 8KB chunks until N newlines (or BOF).
 *  - follow: fs.watch the path. On change, re-stat and read new bytes
 *    between last position and current size. If size shrinks (rotation),
 *    seek to 0 and re-emit BOF→EOF.
 *  - missing file: also watch the parent dir for the file's appearance.
 *  - backpressure: bounded queue of 1000 lines; on overflow emit a
 *    synthetic `[truncated …]` marker and drop oldest.
 */
export class FileTailBroker {
  subscribe(path: string, opts: { initialLines: number }): FileTailSubscription {
    const state: SubscriptionInternals = { closed: false, pending: [], waiter: null };
    let position = 0;
    let lineBuf = "";
    let watcher: FSWatcher | null = null;
    let parentWatcher: FSWatcher | null = null;

    const enqueueLine = (line: string) => {
      if (state.closed) return;
      if (state.pending.length >= 1000) {
        state.pending.splice(0, state.pending.length - 999, "[truncated …]");
      }
      if (state.waiter) {
        const w = state.waiter;
        state.waiter = null;
        w({ value: line, done: false });
      } else {
        state.pending.push(line);
      }
    };

    const drainAppended = async () => {
      if (state.closed) return;
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(path);
      } catch {
        return;
      }
      if (st.size < position) {
        // rotation / truncation
        position = 0;
        lineBuf = "";
      }
      if (st.size === position) return;
      const fh = await open(path, "r");
      try {
        const buf = Buffer.alloc(st.size - position);
        await fh.read(buf, 0, buf.length, position);
        position = st.size;
        lineBuf += buf.toString("utf8");
        let nlIdx = lineBuf.indexOf("\n");
        while (nlIdx >= 0) {
          enqueueLine(lineBuf.slice(0, nlIdx));
          lineBuf = lineBuf.slice(nlIdx + 1);
          nlIdx = lineBuf.indexOf("\n");
        }
      } finally {
        await fh.close();
      }
    };

    const startWatcher = () => {
      try {
        watcher = watch(path, { persistent: false }, () => {
          void drainAppended();
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // fall through to parent watcher
      }
    };

    const startParentWatcher = () => {
      const parent = dirname(path);
      const base = basename(path);
      try {
        parentWatcher = watch(parent, { persistent: false }, (_evt, fname) => {
          if (fname === base) {
            // file appeared; switch to direct watcher and drain.
            if (parentWatcher) {
              parentWatcher.close();
              parentWatcher = null;
            }
            startWatcher();
            void drainAppended();
          }
        });
      } catch {
        // parent dir missing — give up silently.
      }
    };

    // Initial read.
    let initial: string[] = [];
    const initialReady = (async () => {
      try {
        const st = await stat(path);
        position = st.size;
        initial = await readLastLines(path, st.size, opts.initialLines);
      } catch {
        // file missing → empty initial; parent watcher picks up creation.
      }
    })();

    // Kick off watchers after initial read settles.
    void initialReady.then(() => {
      if (state.closed) return;
      try {
        startWatcher();
      } catch {
        startParentWatcher();
        return;
      }
      if (!watcher) startParentWatcher();
    });

    const stream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<string>> {
            if (state.pending.length > 0) {
              return { value: state.pending.shift()!, done: false };
            }
            if (state.closed) return { value: undefined, done: true };
            return new Promise((resolve) => {
              state.waiter = resolve;
            });
          },
          async return(): Promise<IteratorResult<string>> {
            close();
            return { value: undefined, done: true };
          },
        };
      },
    };

    const close = () => {
      if (state.closed) return;
      state.closed = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (parentWatcher) {
        parentWatcher.close();
        parentWatcher = null;
      }
      if (state.waiter) {
        const w = state.waiter;
        state.waiter = null;
        w({ value: undefined, done: true });
      }
    };

    return {
      get initial() {
        return initial;
      },
      stream,
      close,
    };
  }
}

/**
 * Read the last N lines of a file by reading 8KB chunks backwards from
 * `fileSize` until N newlines are counted. Faster than readFile() for big logs.
 */
async function readLastLines(path: string, fileSize: number, n: number): Promise<string[]> {
  if (fileSize === 0 || n === 0) return [];
  const fh = await open(path, "r");
  try {
    const chunkSize = 8 * 1024;
    let pos = fileSize;
    let lines: string[] = [];
    let pendingTail = "";
    while (pos > 0 && lines.length <= n) {
      const start = Math.max(0, pos - chunkSize);
      const len = pos - start;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      pos = start;
      const text = buf.toString("utf8") + pendingTail;
      const split = text.split("\n");
      pendingTail = pos > 0 ? (split.shift() ?? "") : "";
      // remaining are complete lines (latest last); prepend
      lines = split.concat(lines);
    }
    // Drop final empty line that comes from trailing newline.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-n);
  } finally {
    await fh.close();
  }
}
