This file is a placeholder.

In a real install, this path is a symlink pointing to your canonical user
context at `~/.config/agent-smith/USER.md`. The canonical file is shared
across every agent in your install — write your global preferences,
environment notes, name, and project context there once and every agent
(including this one) reads them.

If you are reading this verbatim, the symlink hasn't been created yet.
The installer's Step 8b runs `smith init` for you. If for some reason
your canonical USER.md isn't there, run `smith init-user` (which self-
bootstraps a missing manifest), then re-install this agent — the
install pipeline replaces this stub with the symlink.

## Preferences repo-cartographer honors from USER.md

Specific preferences repo-cartographer honors from USER.md:

- Languages and frameworks you primarily work in (so the cartographer
  knows what entry-point conventions to expect — `package.json` main vs
  `pyproject.toml` scripts vs `Cargo.toml` bin vs `go.mod` module path,
  etc.).
- Conventions about generated/vendored directories to skip (build outputs
  like `dist/` or `target/`, `node_modules/`, `vendor/`, `.venv/`,
  generated proto stubs).
- Whether you want output as prose, as ASCII trees, or as bulleted
  `path:line` lists by default.
- Preferred level of detail for "give me a tour" requests — one-paragraph
  overview vs. directory-by-directory annotated tree.
- Whether the cartographer should ask one clarifying question before
  searching, or always start with a best-effort search and refine after.

## Anything else

Anything else you write in USER.md is read as general user context, not
configuration. The cartographer will pick up your name, your timezone,
your typical project layout, and any standing instructions you have
written for all agents.

If a preference above conflicts with something else in your USER.md, the
cartographer will mention the conflict once and ask which to honor.
