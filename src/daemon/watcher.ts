import chokidar, { type FSWatcher } from "chokidar";

export interface WatcherOptions {
  /**
   * Called with the absolute paths of files that changed since the last
   * debounce window. Note: chokidar may coalesce many low-level events
   * into a single onChange call, so callers receive a SET of paths
   * rather than a single path. This shape lets the daemon distinguish
   * "self-write echo" (every path is something we just installed) from
   * "real user edit" (at least one path is outside install destinations) —
   * see followup #16 in
   * docs/2026-05-02-uninstall-and-jack-out-followups.md.
   */
  onChange: (paths: string[]) => void;
  debounceMs?: number;
}

/**
 * Watch a fixed list of root paths. The caller is responsible for
 * resolving the paths from the registry (and any synthetic sources via
 * resolveAllSources) before invoking startWatcher; this keeps the
 * watcher itself synchronous and easy to test against a literal
 * temp-dir array.
 */
export function startWatcher(paths: string[], options: WatcherOptions): FSWatcher {
  const watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    // Followup #17: never watch VCS metadata or installed deps. The
    // observed bug: with a registered git source, every `git pull`
    // writes .git/FETCH_HEAD inside the watched root, fires chokidar,
    // and triggers a reinstall — running every pull tick (5s in test
    // configs, 15min in prod). node_modules is added defensively so a
    // future JS-project source with auto-installed deps doesn't reproduce
    // the same loop. The predicate matches at any depth so nested cases
    // (e.g. a submodule's .git/) are also excluded.
    ignored: (path: string) => /(?:^|\/)(?:\.git|node_modules)(?:\/|$)/.test(path),
  });

  const debounceMs = options.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Accumulate changed paths across the debounce window. A Set dedups
  // when the same file fires add+change in quick succession (common with
  // editors that write atomically via temp+rename).
  const accumulated = new Set<string>();
  const trigger = (path: string): void => {
    accumulated.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const flush = Array.from(accumulated);
      accumulated.clear();
      options.onChange(flush);
    }, debounceMs);
  };

  watcher.on("add", trigger);
  watcher.on("change", trigger);
  watcher.on("unlink", trigger);
  return watcher;
}
