// Shared test helper: a programmable GitSpawner stub used by acquirer tests.
//
// Callers describe expected git invocations as `StubResponse` entries with a
// `match(args)` predicate, a `result` to return, and an optional `sideEffect`
// that runs against the cwd (e.g. to populate a fake clone directory). Each
// actual invocation is recorded into the `calls` array the caller passes in.
//
// Unmatched invocations resolve with code 128 + a descriptive stderr rather
// than throwing, mirroring real git's "fatal" exit behavior. This keeps the
// acquirer's error-handling paths reachable in tests.
import type { GitRunResult, GitSpawner } from "../../src/core/knowledge/acquire";

export interface StubCall {
  args: string[];
  cwd: string;
}

export interface StubResponse {
  match: (args: string[]) => boolean;
  result: GitRunResult;
  sideEffect?: (cwd: string) => Promise<void>;
}

export function buildSpawner(responses: StubResponse[], calls: StubCall[]): GitSpawner {
  return async (args, cwdParam) => {
    calls.push({ args: [...args], cwd: cwdParam });
    const r = responses.find((x) => x.match(args));
    if (!r) {
      return {
        stdout: "",
        stderr: `unexpected git invocation: ${args.join(" ")}`,
        code: 128,
      };
    }
    if (r.sideEffect) await r.sideEffect(cwdParam);
    return r.result;
  };
}
