/**
 * Canonical kebab-case regex for agent names, bundle ids, and other
 * lowercase-hyphenated identifiers.
 *
 * Single source of truth — re-exported by `src/cli/agent-name.ts` as
 * `KEBAB_AGENT_NAME` for CLI input validation, and imported by both
 * `src/core/config-schema.ts` and `src/core/knowledge/schema.ts` for
 * config-time validation. Lives in its own file (rather than alongside
 * a schema) so the dependency graph is a tree: every consumer imports
 * from here, nothing here imports from anywhere downstream. That keeps
 * the import safe in either schema without circular-init hazards.
 *
 * If you need to change the pattern, change it here. A contract test
 * (tests/contract/kebab-single-source.test.ts) fails if anyone reintroduces
 * a literal copy of this regex elsewhere in `src/`.
 *
 * Tracked under v1 task B2 (docs/2026-05-22-road-to-v1-checklist.md).
 */
export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
