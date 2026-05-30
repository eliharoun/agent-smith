/**
 * Pure helpers for working with the agent `requires.skills` block.
 *
 * `diffRequiredSkills` compares the agent's required-skill list against a
 * list of installed skill names (from `installed-skills.json`) and returns
 * the entries the user is missing.
 *
 * `formatSkillRef` renders an entry as the string form accepted by
 * `smith skill install <ref>`.
 */

export interface RequiredSkillEntry {
  catalog?: string;
  name: string;
}

/**
 * Render a required-skill entry as the string form accepted by
 * `smith skill install <ref>`. Catalog-qualified entries become
 * `"<catalog>/<name>"`; bare entries become `"<name>"`.
 */
export function formatSkillRef(entry: RequiredSkillEntry): string {
  return entry.catalog ? `${entry.catalog}/${entry.name}` : entry.name;
}

/**
 * Returns the entries from `required` whose `name` is not present in
 * `installed`. Preserves field order and the optional `catalog` field
 * verbatim. Matches by name only — installed-skills.json keys by name,
 * so a skill named X is considered installed regardless of which catalog
 * provided it.
 */
export function diffRequiredSkills(
  required: readonly RequiredSkillEntry[],
  installed: readonly string[],
): RequiredSkillEntry[] {
  const installedSet = new Set(installed);
  return required.filter((r) => !installedSet.has(r.name));
}
