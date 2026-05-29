// src/io/opencode-models.ts

/**
 * Cached result of the `opencode models` query for this process.
 *   - `null`        = not yet succeeded (initial state, or all prior attempts failed)
 *   - `string[]`    = successful query (possibly empty); subsequent calls reuse this
 *
 * Failures are intentionally NOT cached: a single transient failure during
 * startup (CLI temporarily missing, opencode crashed mid-spawn, etc.) must
 * not permanently disable model resolution for the lifetime of long-running
 * processes (notably the daemon). See IO-30 in the 2026-05-04 error audit.
 */
let cached: string[] | null = null;

type SpawnResult = {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};
type SpawnFn = () => SpawnResult;

let injectedSpawn: SpawnFn | null = null;

/**
 * Test-only: inject a fake spawn. Pass null to clear.
 * Throws at call-time if invoked outside a test environment, so a malicious
 * or careless production import cannot rebind the spawn function for the
 * process. `bun test` sets NODE_ENV=test automatically.
 */
export function _setSpawnForTesting(fn: SpawnFn | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "_setSpawnForTesting is callable only when NODE_ENV=test (e.g. under `bun test`).",
    );
  }
  injectedSpawn = fn;
}

/**
 * Test-only: clear memoization between tests.
 * Same NODE_ENV guard as _setSpawnForTesting.
 */
export function _resetOpenCodeModelsCache(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "_resetOpenCodeModelsCache is callable only when NODE_ENV=test (e.g. under `bun test`).",
    );
  }
  cached = null;
}

function defaultSpawn(): SpawnResult {
  // Bun.spawnSync exists at runtime; @types/bun provides the type.
  const proc = Bun.spawnSync(["opencode", "models"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout ?? new Uint8Array(),
    stderr: proc.stderr ?? new Uint8Array(),
  };
}

/**
 * Lazily fetch the OpenCode model list via `opencode models`.
 *
 * Memoizes successes per-process (so repeated calls within a single CLI
 * invocation share one spawn). Failures are NOT memoized — each call re-spawns
 * until a success is observed, so transient startup failures do not poison
 * long-running processes (notably the daemon's 15-minute reinstall loop).
 *
 * Returns undefined if the CLI is absent, exits non-zero, or throws (e.g.
 * ENOENT). Filters output to lines matching the `<provider>/<model>` shape so
 * stderr noise (e.g. "warn: ignoring extra certs") is not leaked into parsed
 * results.
 */
export async function getOpenCodeModels(): Promise<string[] | undefined> {
  if (cached !== null) return cached;
  const spawn = injectedSpawn ?? defaultSpawn;
  try {
    const result = spawn();
    if (result.exitCode !== 0) {
      // Do NOT cache failure — let the next call retry.
      return undefined;
    }
    const text = new TextDecoder().decode(result.stdout);
    cached = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && /^[a-z0-9-]+\/[a-z0-9.\-_]+$/i.test(l));
    return cached;
  } catch {
    // Do NOT cache thrown failure — let the next call retry.
    return undefined;
  }
}
