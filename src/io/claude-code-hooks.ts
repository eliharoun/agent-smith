/**
 * Claude-code refresh-hook frontmatter primitives (phase 6).
 *
 * The claude-code refresh hook lives inside the installed agent .md file's
 * YAML frontmatter (see `src/core/translators/claude-code.ts`). The install
 * path writes the hook block during render, but reconfigure needs to add or
 * remove it without re-running the full build pipeline. These helpers do
 * the surgical edit on the installed file.
 *
 * Both helpers are idempotent: re-registering on a file that already has the
 * hook (with matching agent name) is a no-op, and unregistering on a file
 * without the hook is a no-op. Missing files throw on register (you cannot
 * grant a platform the agent isn't installed for) and no-op on unregister
 * (best-effort cleanup mirrors `removeAgentFromCodexHooks`).
 */
import { readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { dump } from "js-yaml";
import { SmithError } from "../core/smith-error";
import { buildSessionStartHook } from "./claude-code-hook-shape";

/** Match the installer's serialize() format: sorted keys, no wrap. */
function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(fm).sort()) sorted[k] = fm[k];
  return `---\n${dump(sorted, { lineWidth: 0, sortKeys: true })}---\n\n${body}`;
}

/**
 * Detect whether the existing `hooks` frontmatter block references the
 * smith refresh-session command for `agent`. Used by both helpers to decide
 * whether to mutate (and to avoid clobbering user-authored hooks blocks).
 */
function hasSmithRefreshHook(hooks: unknown, agent: string): boolean {
  return findSmithRefreshHook(hooks, agent) !== null;
}

/**
 * Locate the (SessionStart entry index, inner hooks[] index) of the smith
 * refresh hook for `agent`. Returns null when not present. Used by the
 * unregister path to remove ONLY the matching entry — wholesale deletion
 * of `fm.hooks` would silently nuke any co-resident user/feature hooks
 * the agent .md might accumulate over its lifetime.
 */
function findSmithRefreshHook(
  hooks: unknown,
  agent: string,
): { sessionIdx: number; hookIdx: number } | null {
  if (!hooks || typeof hooks !== "object") return null;
  const sessionStart = (hooks as { SessionStart?: unknown }).SessionStart;
  if (!Array.isArray(sessionStart)) return null;
  const needle = `--agent ${agent}`;
  for (let sessionIdx = 0; sessionIdx < sessionStart.length; sessionIdx++) {
    const entry = sessionStart[sessionIdx];
    if (!entry || typeof entry !== "object") continue;
    const inner = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(inner)) continue;
    for (let hookIdx = 0; hookIdx < inner.length; hookIdx++) {
      const h = inner[hookIdx];
      if (!h || typeof h !== "object") continue;
      const cmd = (h as { command?: unknown }).command;
      if (typeof cmd === "string" && cmd.includes(needle) && cmd.includes("smith knowledge refresh-session")) {
        return { sessionIdx, hookIdx };
      }
    }
  }
  return null;
}

/**
 * Ensure the claude-code refresh hook block is present in the agent .md
 * frontmatter. Throws SmithError("not-found") when the file is absent —
 * grants for non-installed platforms are caught earlier in reconfigure,
 * but this is a defense-in-depth check for direct callers.
 */
export async function registerClaudeCodeRefreshHook(
  agentMdPath: string,
  agent: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(agentMdPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError({
        code: "not-found",
        what: "claude-code agent file",
        identifier: agentMdPath,
      });
    }
    throw err;
  }
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  if (hasSmithRefreshHook(fm.hooks, agent)) return; // idempotent
  fm.hooks = buildSessionStartHook(agent);
  await writeFile(agentMdPath, serializeFrontmatter(fm, parsed.content.replace(/^\n+/, "")), "utf8");
}

/**
 * Remove the smith refresh hook block from the agent .md frontmatter. No-op
 * when the file is absent or the hook isn't ours. Matches the convention of
 * `removeAgentFromCodexHooks` (never throw on missing artifacts).
 *
 * Surgical: only the matching `SessionStart[i].hooks[j]` entry is removed.
 * If that drains the inner `hooks[]` array, the outer SessionStart entry is
 * removed. If the SessionStart array becomes empty, the key is deleted. If
 * the `hooks` object becomes empty, it is deleted. Co-resident hooks (other
 * events, other SessionStart entries with different commands) are preserved
 * byte-for-byte. Wholesale `delete fm.hooks` would silently nuke them.
 */
export async function unregisterClaudeCodeRefreshHook(
  agentMdPath: string,
  agent: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(agentMdPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const found = findSmithRefreshHook(fm.hooks, agent);
  if (found === null) return; // idempotent — nothing of ours

  const hooks = fm.hooks as Record<string, unknown>;
  const sessionStart = hooks.SessionStart as Array<{ hooks: unknown[] }>;
  const entry = sessionStart[found.sessionIdx]!;
  entry.hooks.splice(found.hookIdx, 1);
  if (entry.hooks.length === 0) {
    sessionStart.splice(found.sessionIdx, 1);
  }
  if (sessionStart.length === 0) {
    delete hooks.SessionStart;
  }
  if (Object.keys(hooks).length === 0) {
    delete fm.hooks;
  }
  await writeFile(agentMdPath, serializeFrontmatter(fm, parsed.content.replace(/^\n+/, "")), "utf8");
}
