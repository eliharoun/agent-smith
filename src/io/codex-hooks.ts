/**
 * Reader/writer for `<codexHome>/hooks.json` with smith ownership semantics.
 *
 * The file is shared between smith and any user-authored Codex hook config,
 * so smith tags its own writes with a `_smith_managed` sentinel containing
 * the list of agents that opted in to knowledge-refresh hooks. Behavior:
 *
 *   - No file present  -> smith creates one on first register.
 *   - File present and smith-tagged -> smith mutates the agent list and
 *     preserves any unrelated top-level keys verbatim.
 *   - File present and NOT smith-tagged -> smith refuses to write and
 *     throws a SmithError. The user-owned file is never modified.
 *
 * Idempotent: re-registering an agent is a no-op; removing an agent that
 * is absent (or removing from a non-smith / missing file) is a no-op.
 * When the agent list empties, the file is deleted entirely so we leave
 * the codex home as we found it.
 *
 * NOTE: SmithError has no `"conflict"` code in its discriminated union, so
 * we report the non-smith-file rejection via `"validation-failed"` with the
 * sentinel-absence reason in `reasons[]`. The headline rendered by the CLI
 * wrapper will be "<what> validation failed"; the test asserts on the full
 * Error message which JS composes as headline + reasons via `formatHeadline`,
 * so we embed the required phrase ("already exists and is not managed by
 * smith") in the `what` field so it surfaces in `.message`.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";

const HOOKS_FILENAME = "hooks.json";

const REFRESH_COMMAND = "smith knowledge refresh-session --platform codex";
const REFRESH_STATUS = "smith: refreshing knowledge\u2026";
const REFRESH_TIMEOUT_SECONDS = 5;
const SESSION_START_MATCHER = "startup|resume";

export interface SmithManaged {
  agents: string[];
  installed_at: string;
}

export interface CodexHookCommand {
  type: "command";
  command: string;
  statusMessage?: string;
  timeout?: number;
}

export interface CodexSessionStartEntry {
  matcher: string;
  hooks: CodexHookCommand[];
}

export interface CodexHooks {
  hooks: {
    SessionStart: CodexSessionStartEntry[];
    [event: string]: unknown;
  };
  _smith_managed: SmithManaged;
  // Preserve unknown top-level keys verbatim across rewrites.
  [otherKey: string]: unknown;
}

function hooksPath(codexHome: string): string {
  return join(codexHome, HOOKS_FILENAME);
}

function isSmithManaged(value: unknown): value is CodexHooks {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  const sentinel = obj._smith_managed;
  if (typeof sentinel !== "object" || sentinel === null) return false;
  const s = sentinel as Record<string, unknown>;
  if (!Array.isArray(s.agents)) return false;
  if (!s.agents.every((a) => typeof a === "string")) return false;
  if (typeof s.installed_at !== "string") return false;
  return true;
}

function buildSessionStartEntry(): CodexSessionStartEntry {
  return {
    matcher: SESSION_START_MATCHER,
    hooks: [
      {
        type: "command",
        command: REFRESH_COMMAND,
        statusMessage: REFRESH_STATUS,
        timeout: REFRESH_TIMEOUT_SECONDS,
      },
    ],
  };
}

/**
 * Read `<codexHome>/hooks.json`. Returns `undefined` when the file is
 * absent OR when it exists but is not smith-managed (callers asking
 * "what does smith own here?" should see nothing in both cases).
 * Throws `SmithError` with code `"validation-failed"` when the file exists
 * but is not valid JSON.
 */
export async function readCodexHooks(
  codexHome: string,
): Promise<CodexHooks | undefined> {
  const path = hooksPath(codexHome);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
  if (!isSmithManaged(parsed)) return undefined;
  return parsed;
}

/**
 * Register `agent` in the codex hooks file. Creates the file with a single
 * SessionStart entry on first call. Idempotent: re-registering the same
 * agent does nothing. Refuses (SmithError) to touch a pre-existing file
 * that lacks the `_smith_managed` sentinel.
 */
export async function registerAgentInCodexHooks(
  codexHome: string,
  agent: string,
): Promise<void> {
  const path = hooksPath(codexHome);
  let raw: string | undefined;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (raw === undefined) {
    // No file yet — create a fresh smith-managed one.
    const fresh: CodexHooks = {
      hooks: { SessionStart: [buildSessionStartEntry()] },
      _smith_managed: { agents: [agent], installed_at: new Date().toISOString() },
    };
    await writeFile(path, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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

  if (!isSmithManaged(parsed)) {
    throw new SmithError({
      code: "validation-failed",
      what: `codex hooks.json at ${path} already exists and is not managed by smith`,
      reasons: [
        `${path}: file is missing the \`_smith_managed\` sentinel; smith refuses to overwrite user-owned hook config`,
        "Move the file aside or merge its contents manually before re-running registration.",
      ],
    });
  }

  // Smith-managed and the agent is already registered — no-op.
  if (parsed._smith_managed.agents.includes(agent)) return;

  // Mutate in place so unknown top-level keys and any extra hook events
  // ride through untouched.
  parsed._smith_managed.agents.push(agent);
  if (
    !Array.isArray(parsed.hooks.SessionStart) ||
    parsed.hooks.SessionStart.length === 0
  ) {
    parsed.hooks.SessionStart = [buildSessionStartEntry()];
  }
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

/**
 * Remove `agent` from the codex hooks file. No-op when the file is missing
 * or is not smith-managed (we never touch user-owned files). Deletes the
 * file entirely when the last smith agent is removed.
 */
export async function removeAgentFromCodexHooks(
  codexHome: string,
  agent: string,
): Promise<void> {
  const path = hooksPath(codexHome);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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

  // Not smith-managed — leave the user's file alone.
  if (!isSmithManaged(parsed)) return;

  const idx = parsed._smith_managed.agents.indexOf(agent);
  if (idx === -1) return; // No-op: agent isn't registered.

  parsed._smith_managed.agents.splice(idx, 1);

  if (parsed._smith_managed.agents.length === 0) {
    // Last smith agent gone — remove the file entirely.
    await rm(path, { force: true });
    return;
  }

  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
