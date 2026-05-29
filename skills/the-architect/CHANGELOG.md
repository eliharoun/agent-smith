# Changelog — the-architect

All notable changes to the the-architect skill.

## 0.0.4 — 2026-05-01

Phase A1 expanded from 7 to 8 questions: new Q7 covers skills (the `permission.skill` capability shipped in agent-smith v0.4.0). Old Q7 (MCP servers) is now Q8.

### Added
- **SKILL.md Phase A1 Q7 (NEW) — Skills.** Single-question, three-mode design:
  - (a) all skills (default — `permission.skill: "allow"`)
  - (b) only specific skills (constructs `{ "<name>": "allow", "*": "deny" }` pattern map; also passes `--skills` so the recommended-defaults section in IDENTITY.md gets generated)
  - (c) all except specific skills (constructs `{ "<bad>": "deny", "*": "allow" }` pattern map)
- Per-platform behavior block under Q7 explaining that OpenCode honors per-skill rules natively, Claude Code collapses to broadest action with a warning, and Codex emits `permission.skill: codex has no native skill-tool runtime; permission ignored.` for any non-default declaration.

### Changed
- **SKILL.md Phase A1** turn count `7` → `8`. All `Q[N] of 7` headings renumbered. "All 7 questions" / "after all 7" / "after Q7" references updated. Failure-mode reference (line 434) updated.
- **SKILL.md Q6** prose updated to mention `skill` as the twelfth capability group, with a forward reference to Q7. The three preset rows updated to reflect that `read-only`, `read-edit`, and `full` all default `skill: "allow"`. Custom-mix instruction now says "twelve groups" (was "eleven").
- **SKILL.md prereq check** bumped `smith --version` floor from `≥ 0.2.0` to `≥ 0.4.0` (Q7 needs `--permission-json` with the skill key, which is v0.4.0).
- **SKILL.md frontmatter** version `0.0.3` → `0.0.4`.

### Verified
- End-to-end smoke test: `smith init-agent` with `--permission-json` containing a `skill` pattern map produces the correct config; the bundle validates; all three translators render the expected output (OpenCode passthrough including pattern map, Claude Code with `Skill` in `allowed-tools`, Codex with the explicit skill warning).

## 0.0.3 — 2026-05-01

Migrated to agent-smith v0.2.0 permission model.

### Changed
- **SKILL.md Q6** rewritten from the legacy `tools: { allow, deny }` model to opencode's `permission` model. Three presets (`read-only`, `read-edit`, `full`) plus `custom`; capability groups enumerated; warning that `"ask"` is opencode-only. CLI flag block updated to `--permission` / `--permission-json`.
- **SKILL.md Phase A2** documents that `--permission` and `--permission-json` are mutually exclusive (`--permission-json` wins) and that omitting both leaves `permission` absent (each platform applies its own defaults).

## 0.0.2 — 2026-05-01

Phase A1 question UX expansion (pattern E: inline explanations + smart defaults + escape hatch).

### Changed
- **SKILL.md Phase A1** rewritten from a bare 7-bullet question list to per-question sections. Each question now carries:
  - 1-2 sentences of framing explaining what the field is and where it lands
  - A markdown options table (or examples block for free-text fields) with a "When to use" / "Recommended default" column
  - At least one concrete example
  - A bolded "**Recommended default.**" marker on the right answer for typical cases
  - A verbatim "Ask the user:" prompt the skill must use
- Added a "use defaults" escape hatch: if the user invokes it at any question, the skill resolves the remaining questions to recommended defaults, surfaces them in a config summary, and asks for confirmation before scaffolding.
- Added a post-Q7 config summary + "Shall I scaffold?" confirmation step.

### Added
- **SKILL.md Phase A2:** note that `smith init-agent --targets all` is rejected by the CLI; expand `all` → `opencode,claude-code,codex` before invoking. (Surfaced by re-eval of `create-vague` against the new UX.)
- **references/persona-files-rubric.md:** clarified that the validator counts non-blank lines (sentences/bullets on their own line), not visual paragraphs in a wrapped editor.
- **references/persona-files-rubric.md:** warning that examples of agent speech are themselves voice-checked — paraphrase in third person ("You acknowledge uncertainty plainly") rather than quoting first-person ("You say 'I'm not sure…'").

### Verified
- Validator: 12 passed, 0 errors, 1 advisory (line-count approaching ceiling).
- Re-ran eval `create-vague` end-to-end with simulated typical-developer user: 12/12 expects met (6 original + 6 new UX-checks).
- SKILL.md body: 295 → 407 non-blank lines (under the 500-line ceiling).

### Commit
`cfddb77 the-architect: expand Phase A1 question UX (pattern E)`

## 0.0.1 — 2026-05-01

Initial ship (Plan #3).

### Added
- **SKILL.md** — frontmatter (562-char description) + body (295 lines) with Iron Law, counter-rationalizations, three workflow flows (create, edit, clone), and a Phase A1 7-question intake (initial bare one-liner version, superseded in 0.0.2).
- **references/persona-files-rubric.md** (190 lines) — voice/length/structure rules for IDENTITY, EXPERTISE, SOUL, USER persona files plus 5 anti-patterns with before/after.
- **evals.json** — 4 sanity-test prompts (`create-vague`, `create-detailed`, `edit-existing`, `clone-from`) with explicit `expects` per prompt.

### Verified
- Validator: 13/13 ✅, exit 0.
- Phase 5 sanity tests: 23/23 expects met across 4 evals, zero iteration. Independent on-disk verification confirmed each artifact.
- Installed via symlinks to `~/.config/opencode/skills/the-architect`, `~/.claude/skills/the-architect`, `~/.config/codex/skills/the-architect`.
- Confirmed live in real OpenCode session (skill discovered, triggers on "create a new agent").

### Commits
- `a29fa18` scaffold
- `1306ddf` frontmatter
- `a01e2ea` SKILL.md body
- `0ee7862` rubric reference
- `47575e1` evals.json
- `8191192` Phase 5 sanity test results
