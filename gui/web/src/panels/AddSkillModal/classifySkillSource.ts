import { classifySource, type SourceKind } from "@/panels/AddAgentModal/classifySource";

export type SkillSourceKind = SourceKind | "catalog-ref";

/**
 * Extends classifySource with a fifth kind: "catalog-ref".
 *
 * A catalog-ref is a bare "catalog/name" string — no scheme, no leading
 * slash, exactly one "/" with simple identifier characters on both sides.
 * The regex intentionally rejects multi-segment paths ("a/b/c") and
 * anything that looks like a real filesystem path.
 *
 * Priority: classifySource runs first. Only when it returns "unknown"
 * do we attempt catalog-ref detection, keeping the two classifiers
 * orthogonal and safe from each other's false positives.
 */
export function classifySkillSource(s: string): SkillSourceKind {
  const base = classifySource(s); // git-url | archive | directory | unknown
  if (base !== "unknown") return base;
  // Only when classifySource gave up: is it a bare catalog/name ref?
  const t = s.trim();
  if (/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(t)) return "catalog-ref";
  return "unknown";
}
