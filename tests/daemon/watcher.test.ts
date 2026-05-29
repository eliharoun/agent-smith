import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWatcher } from "../../src/daemon/watcher";
import { waitFor } from "../_helpers/wait-for";

// Integration tests for the chokidar `ignored` filter (followup #17).
// These use the real chokidar instance against a real temp directory so
// we exercise the actual glob/predicate behavior, not a mock. Without
// the ignore filter, `git pull` writes to .git/FETCH_HEAD inside a
// registered source trigger reinstall storms (observed during manual
// smoke testing of the daemon-hardening branch on 2026-05-04).

async function waitForWatcherReady(watcher: ReturnType<typeof startWatcher>): Promise<void> {
  await new Promise<void>((resolve) => {
    if ((watcher as unknown as { closed?: boolean }).closed) {
      resolve();
      return;
    }
    watcher.on("ready", () => resolve());
  });
}

describe("startWatcher — ignore filter (followup #17)", () => {
  let dir: string;
  let watcher: ReturnType<typeof startWatcher> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-watcher-test-"));
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    await rm(dir, { recursive: true, force: true });
  });

  test("writes inside .git/ do not trigger onChange", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    let calls = 0;
    const sentinelReceived: string[] = [];
    watcher = startWatcher([dir], {
      onChange: (paths) => {
        calls++;
        sentinelReceived.push(...paths);
      },
      debounceMs: 50,
    });
    await waitForWatcherReady(watcher);

    // Simulate `git pull` writing FETCH_HEAD.
    await writeFile(join(dir, ".git/FETCH_HEAD"), "abc123\trefs/heads/main\n");
    await writeFile(join(dir, ".git/HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(dir, ".git/packed-refs"), "# pack-refs\n");

    // Trigger a sentinel file outside ignored areas — wait for ITS event
    await writeFile(join(dir, "SENTINEL.md"), "sentinel\n");
    await waitFor(() => sentinelReceived.some((p) => p.endsWith("SENTINEL.md")), {
      timeoutMs: 2000,
      description: "sentinel file event",
    });

    // By now, if .git events were going to fire, they would have.
    expect(sentinelReceived.some((p) => p.includes(".git"))).toBe(false);
    expect(calls).toBe(1);
  });

  test("writes inside node_modules/ do not trigger onChange", async () => {
    await mkdir(join(dir, "node_modules/some-pkg"), { recursive: true });
    let calls = 0;
    const sentinelReceived: string[] = [];
    watcher = startWatcher([dir], {
      onChange: (paths) => {
        calls++;
        sentinelReceived.push(...paths);
      },
      debounceMs: 50,
    });
    await waitForWatcherReady(watcher);

    await writeFile(join(dir, "node_modules/some-pkg/index.js"), "module.exports = {};\n");

    // Trigger a sentinel file outside ignored areas — wait for ITS event
    await writeFile(join(dir, "SENTINEL.md"), "sentinel\n");
    await waitFor(() => sentinelReceived.some((p) => p.endsWith("SENTINEL.md")), {
      timeoutMs: 2000,
      description: "sentinel file event",
    });

    // By now, if node_modules events were going to fire, they would have.
    expect(sentinelReceived.some((p) => p.includes("node_modules"))).toBe(false);
    expect(calls).toBe(1);
  });

  test("writes outside ignored dirs DO trigger onChange", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const received: string[][] = [];
    watcher = startWatcher([dir], {
      onChange: (paths) => {
        received.push(paths);
      },
      debounceMs: 50,
    });
    await waitForWatcherReady(watcher);

    // A real source file should fire normally.
    await writeFile(join(dir, "AGENT.md"), "# agent\n");

    await waitFor(() => received.length > 0, {
      timeoutMs: 2000,
      description: "AGENT.md change event",
    });

    expect(received.length).toBeGreaterThan(0);
    expect(received.flat()).toContain(join(dir, "AGENT.md"));
  });

  test("mixed batch (.git + real file) only reports the real file", async () => {
    // Defensive: even if a real edit and a git-internal write land in
    // the same debounce window, the .git path must be filtered out at
    // the chokidar layer so the daemon never sees it.
    await mkdir(join(dir, ".git"), { recursive: true });
    const received: string[][] = [];
    watcher = startWatcher([dir], {
      onChange: (paths) => {
        received.push(paths);
      },
      debounceMs: 100,
    });
    await waitForWatcherReady(watcher);

    await writeFile(join(dir, ".git/FETCH_HEAD"), "deadbeef\n");
    await writeFile(join(dir, "AGENT.md"), "# real edit\n");

    await waitFor(() => received.flat().includes(join(dir, "AGENT.md")), {
      timeoutMs: 2000,
      description: "real file in mixed batch",
    });

    const flat = received.flat();
    expect(flat).toContain(join(dir, "AGENT.md"));
    expect(flat.some((p) => p.includes(".git"))).toBe(false);
  });
});
