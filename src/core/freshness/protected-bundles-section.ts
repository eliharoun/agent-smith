// src/core/freshness/protected-bundles-section.ts
//
// Doctor section: lists the entities that are part of the smith product
// surface and therefore protected from mutation/deletion — `agent-smith`
// (the agent), the bundled skills (`the-architect`, `the-keymaker`), plus a
// clone-mode note when smith is running from a maintainer's clone.
//
// Purpose is transparency, not health: it gives the user an honest map of
// "what's mine vs what's smith's". Severity is always informational ("ok") —
// it never affects the doctor exit code. Mirrors the duplicate-catalogs
// section's shape and wiring.

import {
  cloneRepoRoot,
  isLocalSmithClone,
  PROTECTED_AGENTS,
  PROTECTED_SKILLS,
} from "../protected-bundles";

export interface ProtectedBundleFinding {
  kind: "agent" | "skill" | "clone-mode";
  /** Entity name, or the repo root for a clone-mode finding. */
  name: string;
  /** Best-effort source path (rendered/installed location). Omitted for clone-mode. */
  sourcePath?: string;
}

export interface ProtectedBundlesReport {
  findings: ProtectedBundleFinding[];
  cloneMode: boolean;
}

export interface CheckProtectedBundlesInput {
  /** Registry catalogs → agent names, used to detect a present agent-smith. */
  agentNames: Set<string>;
  /** Installed skills, keyed by name → first installed path (any platform). */
  installedSkillPaths: Map<string, string | undefined>;
}

/**
 * Pure: builds the protected-bundles findings from already-loaded registry +
 * installed-skills data. The caller (run-doctor) supplies the lookups so this
 * stays IO-free and trivially testable.
 */
export function checkProtectedBundles(
  input: CheckProtectedBundlesInput,
): ProtectedBundlesReport {
  const findings: ProtectedBundleFinding[] = [];

  for (const name of PROTECTED_AGENTS) {
    if (input.agentNames.has(name)) {
      findings.push({ kind: "agent", name });
    }
  }

  for (const name of PROTECTED_SKILLS) {
    if (input.installedSkillPaths.has(name)) {
      const sourcePath = input.installedSkillPaths.get(name);
      findings.push({
        kind: "skill",
        name,
        ...(sourcePath ? { sourcePath } : {}),
      });
    }
  }

  const cloneMode = isLocalSmithClone();
  if (cloneMode) {
    findings.push({ kind: "clone-mode", name: cloneRepoRoot() ?? "<repo>" });
  }

  return { findings, cloneMode };
}
