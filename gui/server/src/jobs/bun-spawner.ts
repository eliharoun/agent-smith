import type { Spawner, SpawnerOptions, SpawnHandle, SpawnHandlers } from "./job-manager";

export interface BunSpawnerOptions {
  binary: string;
}

export function createBunSpawner(opts: BunSpawnerOptions): Spawner {
  return (argv, handlers, spawnOpts) => spawnOne(opts.binary, argv, handlers, spawnOpts);
}

function spawnOne(
  binary: string,
  argv: string[],
  handlers: SpawnHandlers,
  opts?: SpawnerOptions,
): SpawnHandle {
  const proc = Bun.spawn([binary, ...argv], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    // Merge env overrides on top of the inherited environment so the child
    // still sees PATH, HOME, etc. Passing `process.env` directly (when no
    // overrides) avoids an unnecessary spread.
    env: opts?.env ? { ...process.env, ...opts.env } : (process.env as Record<string, string>),
  });
  pump(proc.stdout, handlers.onStdout);
  pump(proc.stderr, handlers.onStderr);
  proc.exited.then((code) => handlers.onExit(code));
  return {
    stop: () => proc.kill(),
    writeStdin: (text: string) => {
      const writer = proc.stdin;
      if (writer && "write" in writer) {
        (writer as { write: (s: string) => void }).write(text);
      }
    },
  };
}

async function pump(stream: ReadableStream<Uint8Array> | undefined, onChunk: (s: string) => void) {
  if (!stream) return;
  const decoder = new TextDecoder();
  // Bun's ReadableStream supports async iteration; cast for tsc which uses
  // DOM lib types that lack [Symbol.asyncIterator] on ReadableStream.
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    onChunk(decoder.decode(chunk));
  }
}
