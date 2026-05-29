// tests/daemon/fixtures.ts
//
// Shared fixtures for daemon tests. Pure DI surfaces — no real spawn, no real
// filesystem, no real timers unless the test opts in.

import type { Registry } from "../../src/io/registry";
import type { PullResult } from "../../src/io/git";
import type { OrchestratorResult } from "../../src/io/orchestrator";
import type { Source } from "../../src/core/types";

export interface FakeSourceOpts {
  kind?: Source["kind"];
  rootPath?: string;
  label?: string;
  /** Pass `undefined` explicitly to construct a non-git-pullable source. */
  gitRemote?: string | undefined;
}

export function fakeSource(opts: FakeSourceOpts = {}): Source {
  const base: Source = {
    kind: opts.kind ?? "registered",
    rootPath: opts.rootPath ?? "/fake/source",
    label: opts.label ?? "fake",
  } as Source;
  const gitRemote =
    "gitRemote" in opts ? opts.gitRemote : "https://example.com/fake.git";
  if (gitRemote !== undefined) {
    (base as { gitRemote?: string }).gitRemote = gitRemote;
  }
  return base;
}

export function fakeRegistry(sources: Source[] = []): Registry {
  return { schemaVersion: 2, sources };
}

export function okPull(): PullResult {
  return { status: "clean", output: "Already up to date." };
}

export function dirtyPull(porcelain = " M README.md\n"): PullResult {
  return { status: "dirty", porcelain };
}

export function errorPull(message = "fatal: unable to access remote"): PullResult {
  return { status: "error", message };
}

export function emptyInstallResult(): OrchestratorResult {
  return { installed: [], skipped: [], warnings: [], errors: [], grantedKnowledgeDirs: [], knowledge: [] };
}

/**
 * Capturing log sink — collects every line so tests can assert what was
 * logged without spying on the global `console`.
 */
export interface LogSink {
  out: string[];
  err: string[];
  log: (line: string) => void;
  errLog: (line: string) => void;
}

export function makeSink(): LogSink {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (line: string) => out.push(line),
    errLog: (line: string) => err.push(line),
  };
}
