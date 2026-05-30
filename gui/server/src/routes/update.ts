import type { Hono } from "hono";
import { smithBinaryPath } from "../services/smith-binary";

export interface UpdateSpawnResult {
  stdout: string;
  exitCode: number;
}

export interface UpdateRouteDeps {
  /**
   * Test seam. Defaults to `Bun.spawn([smithBinaryPath(), ...argv])`. The
   * argv passed in does NOT include the binary; it starts at `update`.
   */
  spawn?: (argv: string[]) => Promise<UpdateSpawnResult>;
}

async function defaultSpawn(argv: string[]): Promise<UpdateSpawnResult> {
  const proc = Bun.spawn([smithBinaryPath(), ...argv], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

const ALREADY_UP_TO_DATE = /Already up to date/;
const WOULD_PULL = /would pull (\d+) commit\(s\)/;

/**
 * `GET /api/update/preview` — synchronously runs `smith update --dry-run`
 * and parses the textual output into `UpdatePreview`. Returns 500 on spawn
 * failure (e.g. binary missing). Does NOT lock; dry-run is read-only.
 */
export function registerUpdateRoute(app: Hono, deps: UpdateRouteDeps = {}): void {
  const spawn = deps.spawn ?? defaultSpawn;
  app.get("/api/update/preview", async (c) => {
    let result: UpdateSpawnResult;
    try {
      result = await spawn(["update", "--dry-run"]);
    } catch (err) {
      return c.json({ error: "spawn-failed", message: String(err) }, 500);
    }
    const alreadyUpToDate = ALREADY_UP_TO_DATE.test(result.stdout);
    const pullMatch = result.stdout.match(WOULD_PULL);
    const commitsBehind = pullMatch && pullMatch[1] ? Number.parseInt(pullMatch[1], 10) : 0;
    return c.json({
      commitsBehind: alreadyUpToDate ? 0 : commitsBehind,
      alreadyUpToDate,
      rawOutput: result.stdout,
    });
  });
}
