import { type FileHandle, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface OpenMcpStderrLogOpts {
  logDir: string;
  serverName: string;
  maxBytes?: number;
  maxFiles?: number;
}

export interface LogWriter {
  write(chunk: Buffer | string): void;
  close(): Promise<void>;
}

/**
 * Open a per-server stderr log under `<logDir>/<serverName>.log`. Returns
 * a LogWriter whose `write` is fire-and-forget (never throws; never blocks
 * the caller) and whose `close` flushes pending writes and releases the fd.
 *
 * Rotation: when the existing file is > maxBytes (10MB default), it's
 * renamed to `<serverName>.log.1`, then `.1 -> .2`, etc., dropping anything
 * past `maxFiles` (3 default). Rotation runs at open time only; mid-session
 * we keep writing to the same fd.
 *
 * Failure mode: if mkdir or open fails, the writer no-ops on every call.
 * Smith never crashes on log-write errors.
 */
export async function openMcpStderrLog(opts: OpenMcpStderrLogOpts): Promise<LogWriter> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 3;
  const safeName = sanitizeName(opts.serverName);
  const path = join(opts.logDir, `${safeName}.log`);

  try {
    await mkdir(opts.logDir, { recursive: true });
  } catch {
    return noopWriter();
  }

  try {
    const st = await stat(path);
    if (st.size > maxBytes) {
      await rotate(opts.logDir, safeName, maxFiles);
    }
  } catch {
    // ENOENT expected on first open; other errors fall through to the open
    // attempt below (which fails into noopWriter).
  }

  let fh: FileHandle | null = null;
  try {
    fh = await open(path, "a");
  } catch {
    return noopWriter();
  }
  const handle = fh;

  let chain: Promise<unknown> = Promise.resolve();
  return {
    write(chunk) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      chain = chain.then(() => handle.write(buf)).catch(() => {});
    },
    async close() {
      try {
        await chain;
      } finally {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

function sanitizeName(name: string): string {
  // Preserve a leading "../" as "..__" so path-traversal markers stay
  // recognizable in log filenames after sanitization.
  const prefixed = name.replace(/^\.\.\//, "..__");
  const replaced = prefixed.replace(/[^A-Za-z0-9._-]/g, "_");
  return replaced.slice(0, 64);
}

async function rotate(logDir: string, name: string, maxFiles: number): Promise<void> {
  try {
    await unlink(join(logDir, `${name}.log.${maxFiles}`));
  } catch {
    // ENOENT — nothing to drop.
  }
  for (let i = maxFiles - 1; i >= 1; i--) {
    try {
      await rename(join(logDir, `${name}.log.${i}`), join(logDir, `${name}.log.${i + 1}`));
    } catch {
      // ENOENT — that level didn't exist yet.
    }
  }
  try {
    await rename(join(logDir, `${name}.log`), join(logDir, `${name}.log.1`));
  } catch {
    // ENOENT — first rotation with no prior writes.
  }
}

function noopWriter(): LogWriter {
  return {
    write() {},
    async close() {},
  };
}
