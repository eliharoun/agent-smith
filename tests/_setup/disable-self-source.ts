/**
 * Test preload: suppress GUI server bootstrap injections that would
 * otherwise pollute fixture-based tests with state from the running
 * workspace.
 *
 *   SMITH_DISABLE_SELF_SOURCE     — suppress the synthetic
 *                                    "agent-smith-self" source that
 *                                    parseRegistry injects (see
 *                                    gui/server/src/services/self-source.ts).
 *   SMITH_DISABLE_SKILL_BOOTSTRAP — suppress the protected
 *                                    "atlassian-skills" catalog that
 *                                    loadSkillCatalogs injects when
 *                                    skill-catalogs.json is missing
 *                                    (mirrors loadSkillRegistry; see
 *                                    gui/server/src/services/scan-skill-catalogs.ts).
 *
 * At runtime these injections are correct — the GUI should see the
 * bundled `agent-smith` agent and the bootstrap atlassian-skills catalog
 * without forcing the user to register them. But during tests, the
 * running workspace IS the agent-smith repo, so they pollute fixture-
 * based assertions that assume a controlled registry shape.
 *
 * Tests that specifically exercise either feature explicitly delete the
 * relevant env var in their own setup.
 *
 *   NO_COLOR                      — force picocolors to emit PLAIN text so
 *                                    output assertions are deterministic.
 *                                    picocolors decides color support once,
 *                                    at import, and ENABLES it whenever the
 *                                    env says so — notably `CI=true` (set by
 *                                    GitHub Actions) or `FORCE_COLOR`. Without
 *                                    this, every test asserting uncolored text
 *                                    passes locally (no color) but fails in CI
 *                                    (ANSI escapes leak into the assertion).
 *                                    Setting NO_COLOR here (a preload with no
 *                                    imports, so it runs before picocolors is
 *                                    ever imported) makes the plain-output
 *                                    contract hold in every environment.
 *                                    Production `smith` runs still colorize.
 */
process.env.SMITH_DISABLE_SELF_SOURCE = "1";
process.env.SMITH_DISABLE_SKILL_BOOTSTRAP = "1";
process.env.NO_COLOR = "1";
