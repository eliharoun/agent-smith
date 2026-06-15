import pc from "picocolors";
import {
  SmithError,
  formatHeadline,
  formatRemediation,
  type SmithErrorPayload,
} from "../core/smith-error";
import { isDebug } from "./debug-flag";
import { EXIT_RUNTIME, exitCodeFor } from "./exit-codes";

export type CommandFn<Args extends unknown[]> = (...args: Args) => Promise<number>;

/**
 * Test seams. In production, all four fall through to defaults derived from
 * the host process. Tests pass capture functions and `debug: false` to keep
 * output deterministic.
 *
 * `rethrow` is a test-only escape hatch: when true, `wrap()` re-throws the
 * action's original error instead of routing it through `handleThrow` (which
 * formats + prints + exits, destroying the original error in the process).
 * Tests that drive commands via `program.parseAsync(...).catch(e => e)` and
 * want to assert on the original SmithError MUST set this; production callers
 * never do.
 */
export interface WrapDeps {
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  exit?: (code: number) => never;
  debug?: boolean;
  rethrow?: boolean;
}

function defaultDeps(): Required<WrapDeps> {
  return {
    print: (s: string) => {
      console.log(s);
    },
    printErr: (s: string) => {
      console.error(s);
    },
    exit: (code: number) => {
      process.exit(code);
    },
    debug: isDebug(),
    rethrow: false,
  };
}

/**
 * Wrap a command function so it can be passed to commander's `.action(...)`.
 * Funnels every command through one place that:
 *   - calls fn with the args commander hands it
 *   - exits with whatever number fn returns (fn owns its UX on success/failure)
 *   - on SmithError throw: renders structured message, exits with mapped code
 *   - on unknown throw: renders unexpected-error message, exits 1
 *   - on formatter failure: bare-bones fallback to stderr, exits 1
 *
 * fn is responsible for printing its own user-facing output. wrap() never
 * prints anything when fn returns normally.
 */
export function wrap<Args extends unknown[]>(
  name: string,
  fn: CommandFn<Args>,
  depsOverride?: WrapDeps,
): (...args: Args) => Promise<void> {
  const deps = { ...defaultDeps(), ...depsOverride };
  return async (...args: Args): Promise<void> => {
    let code: number;
    try {
      code = await fn(...args);
    } catch (err) {
      // Test seam: tests that drive this through `parseAsync(...).catch(e => e)`
      // need the original SmithError, not whatever handleThrow synthesises after
      // print + exit. Production never sets rethrow.
      if (deps.rethrow) {
        throw err;
      }
      handleThrow(name, err, deps);
      return; // unreachable — handleThrow always exits via deps.exit
    }
    // Test seam: in rethrow mode, the host is bun-test, NOT the smith CLI.
    // Calling process.exit on success would kill the test runner. Tests that
    // care about the success exit code can spy on stdout or check side effects;
    // they should not call exit at all in this mode.
    if (deps.rethrow) {
      return;
    }
    deps.exit(code);
  };
}

function handleThrow(name: string, err: unknown, deps: Required<WrapDeps>): never {
  let rendered: string;
  let code: number;
  try {
    if (err instanceof SmithError) {
      rendered = formatSmithError(name, err, deps.debug);
      code = exitCodeFor(err.payload.code);
    } else {
      rendered = formatUnknownError(name, err, deps.debug);
      code = EXIT_RUNTIME;
    }
  } catch (formatterErr) {
    // Defensive: if our own renderer blows up, do NOT swallow the original
    // failure. Print a minimal fallback so the user sees *something*, then
    // exit 1. We deliberately avoid picocolors here in case that's what broke.
    try {
      deps.printErr(
        `[smith internal] formatter threw: ${(formatterErr as Error).message ?? String(formatterErr)}`,
      );
      deps.printErr(
        `Original error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    } catch {
      // Even printErr broke. Nothing left to do.
    }
    deps.exit(EXIT_RUNTIME);
    throw new Error("unreachable");
  }
  // Print + exit happen outside the formatter try/catch so that a printErr
  // that throws (or an exit() that throws, as in tests) is not misclassified
  // as a formatter failure.
  try {
    deps.printErr(rendered);
  } catch {
    // printErr broke; still exit with the intended code.
  }
  deps.exit(code);
  throw new Error("unreachable");
}

const INDENT = "  ";

function indent(s: string): string {
  return s
    .split("\n")
    .map((line) => (line.length > 0 ? `${INDENT}${line}` : line))
    .join("\n");
}

/**
 * Body line(s) per payload code. Returning switch with NO default — adding
 * a new SmithErrorPayload variant forces a compile error here, matching the
 * exhaustiveness discipline in src/core/smith-error.ts.
 */
function bodyFor(payload: SmithErrorPayload): string {
  switch (payload.code) {
    case "registry-version":
    case "skill-registry-version":
      return `Found version ${payload.current} in ${payload.path} (expected ${payload.expected})`;
    case "registry-corrupt-json":
    case "installed-skills-corrupt":
      return `${payload.path}: ${payload.parseError}`;
    case "registry-corrupt-shape":
      return payload.reasons.map((r) => `- ${r}`).join("\n");
    case "config-missing":
      return `${payload.path} does not exist`;
    case "permission-denied":
      return `${payload.path}: ${payload.operation}`;
    case "usage-error":
      // Headline already shows the message; body is empty.
      return "";
    case "validation-failed":
      return payload.reasons.map((r) => `- ${r}`).join("\n");
    case "partial-failure": {
      const summary = `${payload.succeeded} succeeded, ${payload.failed} failed, ${payload.skipped} skipped`;
      const items = payload.details.map((d) => `- ${d}`).join("\n");
      return items.length > 0 ? `${summary}\n${items}` : summary;
    }
    case "not-found":
    case "already-exists":
      // Headline already conveys the issue; body is empty.
      return "";
    case "protected-catalog":
      // Headline already conveys the issue; body is empty.
      return "";
    case "protected-bundle":
    case "user-aborted":
      // Headline carries the full message; no extra body.
      return "";
    case "skill-registry-corrupt-json":
      return `${payload.path}: ${payload.parseError}`;
    case "skill-registry-corrupt-shape":
      return payload.reasons.map((r) => `- ${r}`).join("\n");
    case "http-error": {
      const lines = [payload.url];
      if (payload.snippet) lines.push(payload.snippet);
      return lines.join("\n");
    }
    case "network-error":
      return `${payload.url}\nCause: ${payload.cause}`;
    case "internal-error":
      // Headline + remediation already convey the message; body is empty.
      return "";
    case "model-resolution-failed":
      return `Agent: ${payload.agent}\nPreferences: ${payload.preferences.join(", ")}\nAuthenticated: ${payload.authenticated.join(", ")}`;
  }
}

export function formatSmithError(name: string, err: SmithError, debug: boolean): string {
  const headline = stripRedundantCommandPrefix(name, formatHeadline(err.payload));
  const body = bodyFor(err.payload);
  const remediation = formatRemediation(err.payload);

  const parts: string[] = [];
  parts.push(`${pc.red("✗")} smith ${name}: ${headline}`);
  if (body.length > 0) parts.push(indent(body));
  if (remediation.length > 0) {
    parts.push(""); // blank line separator
    parts.push(indent(remediation));
  }

  if (debug) {
    parts.push("");
    parts.push(indent(pc.dim(`Payload: ${JSON.stringify(err.payload, null, 2)}`)));
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeStack = cause instanceof Error ? (cause.stack ?? cause.message) : "(no cause)";
    parts.push(indent(pc.dim(`Cause: ${causeStack}`)));
  }

  return parts.join("\n");
}

/**
 * If a usage-error message starts with `smith <cmd>: ` (where `<cmd>` matches
 * the wrap header's command path), strip that redundant prefix. Without this,
 * a usage-error composed as "smith knowledge requires a subcommand: ..." renders
 * as "✗ smith knowledge: smith knowledge requires..." — double label.
 *
 * Conservative: only strips when the prefix is an exact match for the wrap's
 * command name. Messages that mention `smith <other-cmd>:` mid-sentence are
 * untouched.
 */
function stripRedundantCommandPrefix(name: string, headline: string): string {
  // Match either "smith <name>: ..." or "smith <name> ..." (no colon, when the
  // composer wrote it as a sentence beginning with the command path).
  const withColon = `smith ${name}: `;
  if (headline.startsWith(withColon)) {
    return headline.slice(withColon.length);
  }
  const withoutColon = `smith ${name} `;
  if (headline.startsWith(withoutColon)) {
    return headline.slice(withoutColon.length);
  }
  return headline;
}

export function formatUnknownError(name: string, err: unknown, debug: boolean): string {
  const message = err instanceof Error ? err.message : String(err);
  const parts: string[] = [];
  parts.push(`${pc.red("✗")} smith ${name}: unexpected error`);
  parts.push(indent(message));

  if (debug) {
    if (err instanceof Error && err.stack) {
      // err.stack typically starts with "Error: msg\n    at ...". Skip the
      // first line (already shown as message) and indent the frames.
      const frames = err.stack.split("\n").slice(1).join("\n");
      parts.push(
        frames
          .split("\n")
          .map((l) => `      ${l.trimStart()}`)
          .join("\n"),
      );
    }
    parts.push("");
    parts.push(indent("No SmithError payload — this was a raw throw."));
  } else {
    parts.push("");
    parts.push(indent("This is a bug in agent-smith. Re-run with SMITH_DEBUG=1 for a full"));
    parts.push(indent("stack trace, then file at:"));
    parts.push(indent("https://github.com/eliharoun/agent-smith/issues"));
  }

  return parts.join("\n");
}

/**
 * Convert a commander CommanderError (thrown when exitOverride() is enabled)
 * to a SmithError so it flows through the same render path. Commander's own
 * error message (e.g. "missing required argument 'path'") is already
 * actionable, so we surface it as the headline with no remediation.
 *
 * Strips commander's leading "error: " prefix so the rendered output reads
 * "✗ smith: unknown command 'foo'" instead of the doubled
 * "✗ smith: error: unknown command 'foo'".
 */
export function formatCommanderError(err: unknown): SmithError {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.replace(/^error:\s*/, "");
  return new SmithError({ code: "usage-error", message });
}
