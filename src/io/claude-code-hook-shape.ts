/**
 * Canonical Claude Code session-start hook frontmatter shape.
 *
 * The runner contract is `smith knowledge refresh-session --agent <name>
 * --platform claude-code` — invoked by Claude Code on session startup or
 * resume to rebuild the agent's knowledge index before the first prompt.
 *
 * The returned object matches Claude Code's documented hooks frontmatter
 * schema (an object keyed by event name, each value an array of
 * { matcher, hooks: [{ type, command, ... }] } entries).
 *
 * This is the single source of truth for the install-time hook shape:
 * the claude-code translator (`src/core/translators/claude-code.ts`) and
 * the hook register/unregister helpers (`src/io/claude-code-hooks.ts`)
 * both consume this. Future hook variants (UserPromptSubmit, etc.) belong
 * alongside this one.
 */
export function buildSessionStartHook(agent: string): Record<string, unknown> {
  return {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          {
            type: "command",
            command: `smith knowledge refresh-session --agent ${agent} --platform claude-code`,
            statusMessage: `Refreshing ${agent} knowledge…`,
            timeout: 5,
          },
        ],
      },
    ],
  };
}
