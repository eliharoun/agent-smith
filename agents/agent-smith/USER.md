This file is a placeholder.

In a real install, this path is a symlink pointing to your canonical user context at `~/.config/agent-smith/USER.md`. The canonical file is shared across every agent in your install — write your global preferences, environment notes, name, and project context there once and every agent (including this one) reads them.

If you are reading this verbatim, the symlink hasn't been created yet. The installer's Step 8b runs `smith init` for you, which seeds your canonical USER.md automatically. If for some reason it isn't there, run `smith init-user` (it self-bootstraps a missing manifest) and then `smith agent install agent-smith` to re-install this persona — the install pipeline replaces this stub with the symlink.

Specific preferences agent-smith honors from USER.md:

- `agent-smith persona: matrix` — start sessions in matrix-villain voice instead of the default methodical voice. See SOUL.md for full voice rules.
- `agent-smith persona: methodical` — explicit default (same as omitting the line).

Anything else you write in USER.md is read by agent-smith but treated as general user context, not configuration.
