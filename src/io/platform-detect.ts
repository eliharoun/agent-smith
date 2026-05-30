/**
 * Detect which supported AI coding platform CLIs are installed on the
 * user's PATH. Used by `smith doctor` to filter its report to only the
 * sections that are actionable in the user's environment.
 *
 * Detection signal: the platform's CLI binary resolvable via `which`.
 * Smith's own installed-skills/registry state is intentionally NOT used —
 * a user who deleted the runtime but kept smith state should see "platform
 * gone," not a stale section.
 */

/**
 * Canonical ordered tuple of supported platform IDs. Exported as a
 * `readonly` tuple (not just a type) so downstream modules can build
 * `z.enum(PLATFORM_IDS)` schemas without redeclaring the value set —
 * one source of truth, no drift between this list and validators.
 */
export const PLATFORM_IDS = ["opencode", "claude-code", "codex", "kiro"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/**
 * Canonical PATH binary name(s) for each supported platform. A `string[]`
 * value means any one of the listed binaries on PATH suffices to consider
 * the platform installed.
 *
 * Kiro is the only multi-binary entry today: kiro-cli (terminal CLI) and
 * kiro (IDE wrapper) consume the same agent format from the same on-disk
 * dir, so detecting either suffices. kiro-cli is preferred for shell-out
 * (it has the `agent validate --path` subcommand the IDE wrapper lacks)
 * but the IDE-only install is still a valid platform presence signal.
 */
export const PLATFORM_BINARIES: Record<PlatformId, string | string[]> = {
  opencode: "opencode",
  "claude-code": "claude",
  codex: "codex",
  kiro: ["kiro-cli", "kiro"],
};

async function defaultWhich(binary: string): Promise<string | null> {
  // Bun.which is synchronous and built-in; the async signature here matches
  // the injectable `which` callback shape for testability.
  return Bun.which(binary);
}

/**
 * Return the absolute path of `binary` on PATH, or null if not found.
 * The `which` callback is injectable for tests; injected callbacks are
 * expected to return null (not throw) on lookup failure.
 */
export async function findOnPath(
  binary: string,
  which: (bin: string) => Promise<string | null> = defaultWhich,
): Promise<string | null> {
  const raw = await which(binary);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Probe PATH for every supported platform's CLI binary in parallel and
 * return the set of platforms whose binary is present. The `which`
 * callback is injectable for tests; production calls default through
 * `findOnPath`.
 *
 * For platforms with multiple acceptable binaries (currently only kiro),
 * any one resolving on PATH counts as the platform being installed.
 */
export async function detectInstalledPlatforms(
  which: (bin: string) => Promise<string | null> = (bin) => findOnPath(bin),
): Promise<Set<PlatformId>> {
  const entries = Object.entries(PLATFORM_BINARIES) as Array<
    [PlatformId, string | string[]]
  >;
  const results = await Promise.all(
    entries.map(async ([id, bins]) => {
      const list = Array.isArray(bins) ? bins : [bins];
      for (const bin of list) {
        const path = await which(bin);
        if (path !== null) return [id, path] as const;
      }
      return [id, null] as const;
    }),
  );
  const set = new Set<PlatformId>();
  for (const [id, path] of results) {
    if (path !== null) set.add(id);
  }
  return set;
}
