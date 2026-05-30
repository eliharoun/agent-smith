/**
 * One-shot upgrade helper for users coming from agent-smith <0.15 who
 * hand-wrote `~/.codex/hooks.json` to invoke `smith knowledge refresh-session`
 * before Phase-4 introduced smith ownership of that file.
 *
 * Phase-4's installer (`src/io/codex-hooks.ts`) refuses to touch a hooks
 * file that lacks the `_smith_managed` sentinel, so an upgrading user with
 * a pre-existing hand-written file gets a hard stop. This helper offers a
 * structured way out:
 *
 *   - file missing                         -> noop (install will create it)
 *   - already has `_smith_managed`         -> noop ("already managed")
 *   - empty/missing `hooks`                -> noop ("no smith hooks to claim")
 *   - every command is smith-compatible    -> claim ownership by writing the
 *                                             sentinel (agents starts empty;
 *                                             install adds entries normally)
 *   - any unrelated command present        -> conflict; return the list of
 *                                             {event, command} pairs; DO NOT
 *                                             touch the file
 *
 * The needle for "smith-compatible" is `smith knowledge refresh-session`
 * with any internal whitespace; this matches both pre-0.15 hand-written
 * variants and the canonical 0.15+ form (which adds `--platform codex`).
 */
import { readFile, writeFile } from "node:fs/promises";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";

export type MigrateResult =
  | { action: "noop"; reason: string }
  | { action: "claimed" }
  | {
      action: "conflict";
      unrelated: Array<{ event: string; matcher?: string; command: string }>;
    };

// Tolerate any whitespace between tokens — pre-0.15 users may have typed
// `smith  knowledge   refresh-session` or split across lines via a shell
// script wrapper. The canonical 0.15+ form is
// `smith knowledge refresh-session --platform codex`.
const SMITH_COMMAND_RE = /\bsmith\s+knowledge\s+refresh-session\b/;

// Cap synthetic payload representations so a pathological file (e.g. a
// 10MB string at hooks.SessionStart) doesn't bloat the error report.
const SYNTHETIC_MAX = 200;
function synthetic(value: unknown): string {
  const repr = typeof value === "string" ? value : JSON.stringify(value);
  const safe = typeof repr === "string" ? repr : String(repr);
  return safe.length > SYNTHETIC_MAX
    ? `${safe.slice(0, SYNTHETIC_MAX)}…[truncated]`
    : safe;
}

function isSmithCompatible(command: unknown): boolean {
  return typeof command === "string" && SMITH_COMMAND_RE.test(command);
}

function isManaged(parsed: Record<string, unknown>): boolean {
  return (
    typeof parsed._smith_managed === "object" &&
    parsed._smith_managed !== null
  );
}

interface InnerHook {
  command?: unknown;
}
interface EntryGroup {
  matcher?: unknown;
  hooks?: unknown;
}

export async function migrateCodexHooks(path: string): Promise<MigrateResult> {
  // 1. Missing file -> noop. Regular install path creates a fresh smith-
  //    managed file from scratch.
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { action: "noop", reason: "no hooks.json present" };
    }
    throw err;
  }

  // 2. Parse — bad JSON is a hard error (same path as readCodexHooks).
  let parsed: Record<string, unknown>;
  try {
    const decoded = JSON.parse(raw);
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error("expected a JSON object at the top level");
    }
    parsed = decoded as Record<string, unknown>;
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "codex hooks.json",
        reasons: [`${path}: failed to parse as JSON: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }

  // 3. Already smith-owned -> nothing to do.
  if (isManaged(parsed)) {
    return { action: "noop", reason: "file is already managed by smith" };
  }

  // 4. No hooks at all -> noop. Install will create the file fresh.
  const hooks = parsed.hooks;
  if (
    typeof hooks !== "object" ||
    hooks === null ||
    Array.isArray(hooks) ||
    Object.keys(hooks).length === 0
  ) {
    return { action: "noop", reason: "no smith hooks to claim" };
  }

  // 5. Walk every event group; classify each command. Anything we cannot
  //    interpret as a smith-compatible entry — non-array event values,
  //    non-array inner hooks, non-object inner hooks, missing/non-string
  //    commands — is surfaced as an unrelated entry rather than silently
  //    swallowed. Otherwise broken shapes would classify as noop and the
  //    user would be told "nothing to migrate" while `agent install` still
  //    refuses the file for lacking the sentinel.
  const unrelated: Array<{ event: string; matcher?: string; command: string }> =
    [];
  let sawAnyCommand = false;
  for (const [event, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      // Malformed event value (e.g. `SessionStart: "smith ..."`).
      sawAnyCommand = true;
      unrelated.push({ event, command: synthetic(value) });
      continue;
    }
    for (const group of value as EntryGroup[]) {
      const matcher =
        typeof group?.matcher === "string" ? group.matcher : undefined;
      const innerRaw = group?.hooks;
      if (!Array.isArray(innerRaw)) {
        // EntryGroup present but its `hooks` is missing or wrong shape.
        sawAnyCommand = true;
        unrelated.push({
          event,
          ...(matcher !== undefined ? { matcher } : {}),
          command: synthetic(innerRaw),
        });
        continue;
      }
      for (const hook of innerRaw as InnerHook[]) {
        sawAnyCommand = true;
        const cmd = hook?.command;
        if (!isSmithCompatible(cmd)) {
          unrelated.push({
            event,
            ...(matcher !== undefined ? { matcher } : {}),
            command: typeof cmd === "string" ? cmd : synthetic(cmd),
          });
        }
      }
    }
  }

  if (!sawAnyCommand) {
    return { action: "noop", reason: "no smith hooks to claim" };
  }

  // 6. Any unrelated command -> conflict; file untouched.
  if (unrelated.length > 0) {
    return { action: "conflict", unrelated };
  }

  // 7. All commands smith-compatible -> claim ownership in place. Preserve
  //    the original `hooks` tree byte-shape (only mutate by adding the
  //    `_smith_managed` sentinel) so any user-tuned matchers/timeouts ride
  //    through. The agents list starts empty; subsequent
  //    `smith agent install --target codex` will populate it.
  const claimed = {
    ...parsed,
    _smith_managed: {
      agents: [] as string[],
      installed_at: new Date().toISOString(),
    },
  };
  await writeFile(path, `${JSON.stringify(claimed, null, 2)}\n`, "utf8");
  return { action: "claimed" };
}
