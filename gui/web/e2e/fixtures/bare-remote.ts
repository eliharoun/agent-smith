// gui/web/e2e/fixtures/bare-remote.ts
//
// Playwright-side wrapper around the runtime-neutral fixture in
// tests/fixtures/git-remote-helper.ts. Spins up a local bare git repo,
// optionally seeds it with a single file, runs the caller's block, then
// tears the tmpdir down regardless of pass/fail.
//
// Why a wrapper (and not a Playwright `test.extend` fixture): the install
// and sync specs (C4.10.2, C4.10.3) need fine-grained control over when
// the remote gains additional commits relative to UI interactions. A
// plain `withBareRemote(callback)` keeps that orchestration explicit at
// the test site without coupling fixture lifetime to test setup/teardown.

import type { TestInfo } from "@playwright/test";
import { createBareRemote } from "../../../../tests/fixtures/git-remote-helper";

export interface BareRemoteHandle {
  /** file:// URL — accepted by `git clone` and by the GUI install flow. */
  url: string;
  /** Local working-tree path (separate from the bare repo) used to push
   *  additional commits during the test. */
  workdir: string;
  /** Pushes a new commit with the given file contents and returns its sha. */
  commitFile(relPath: string, contents: string, message?: string): Promise<string>;
  /** Returns the current HEAD sha on the bare remote (40-char hex). */
  headSha(): Promise<string>;
}

export interface WithBareRemoteOptions {
  /** Seed the bare repo with a single file before invoking the callback.
   *  Useful for install specs that need a real `agent.config.json` /
   *  `agent.yaml` / `SKILL.md` to discover at clone time. */
  initialFile?: { path: string; contents: string };
  /** Seed the bare repo with multiple files (each committed in order via
   *  `commitFile`). When both `initialFile` and `initialFiles` are
   *  provided, `initialFile` lands first. Needed by the install spec
   *  (C4.10.2), which must seed a full persona bundle
   *  (agent.config.json + IDENTITY/EXPERTISE/SOUL/USER) so the
   *  CLI validator and GUI server's `scanBundle` both accept the
   *  cloned tree. */
  initialFiles?: Array<{ path: string; contents: string }>;
}

export async function withBareRemote(
  _testInfo: TestInfo,
  fn: (handle: BareRemoteHandle) => Promise<void>,
  opts: WithBareRemoteOptions = {},
): Promise<void> {
  const remote = await createBareRemote();
  try {
    if (opts.initialFile) {
      await remote.commitFile(opts.initialFile.path, opts.initialFile.contents);
    }
    if (opts.initialFiles) {
      for (const file of opts.initialFiles) {
        await remote.commitFile(file.path, file.contents);
      }
    }
    await fn({
      url: remote.url,
      workdir: remote.workdir,
      commitFile: remote.commitFile,
      headSha: remote.headSha,
    });
  } finally {
    await remote.cleanup();
  }
}
