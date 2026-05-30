// tests/fixtures/git-remote-helper.test.ts
//
// C4.0.5 (v1-task): pin the bare-git fixture as runtime-neutral so it
// can be re-used from Playwright (Node-only) in C4.10 without rewrites.
// Two cheap guards: a behavior smoke test (it actually creates a usable
// bare repo) and a source-level assertion that no Bun globals leaked in.

import { afterEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createBareRemote } from "./git-remote-helper";

describe("git-remote-helper runtime-neutral (C4.0.5)", () => {
  const created: Array<{ cleanup: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const r of created) await r.cleanup();
    created.length = 0;
  });

  test("createBareRemote returns a file:// URL pointing to a real bare repo", async () => {
    const remote = await createBareRemote();
    created.push(remote);
    expect(remote.url).toMatch(/^file:\/\//);
    expect(remote.workdir).toBeTruthy();
    // The bare repo path is the URL minus file://.
    const barePath = remote.url.replace(/^file:\/\//, "");
    expect((await stat(join(barePath, "HEAD"))).isFile()).toBe(true);
  });

  test("commitFile + headSha round-trip works (smoke)", async () => {
    const remote = await createBareRemote();
    created.push(remote);
    const sha = await remote.commitFile("a.txt", "hello\n");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await remote.headSha()).toBe(sha);
  });

  test("source uses node:child_process / node:fs/promises (no Bun globals)", async () => {
    // Read the helper's source and assert that no `Bun.*` API was introduced.
    // Source-level grep is fragile, but cheap and prevents the most common
    // regression: a maintainer reaching for Bun.spawn out of habit.
    const src = await readFile(new URL("./git-remote-helper.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/\bBun\.spawn\b/);
    expect(src).not.toMatch(/\bBun\.file\b/);
    expect(src).not.toMatch(/\bBun\.write\b/);
    // Positive assertion: it should be using the node: imports.
    expect(src).toMatch(/from\s+["']node:child_process["']/);
    expect(src).toMatch(/from\s+["']node:fs\/promises["']/);
  });
});
