import type { KnowledgeSourceType } from "./types";

/**
 * Maps a knowledge source type to a preferred live-query skill. The assembler
 * emits a `## Tool Routing Policy` section when (a) an agent declares
 * knowledge of `knowledgeType` AND (b) the agent's `skills[]` includes
 * `skill`. The policy instructs the agent to use the live skill first and
 * fall back to the materialized cache as a stale snapshot.
 *
 * Adding a new mapping (e.g., GitHub via `gh` CLI) is a one-line entry here;
 * no assembler change required.
 */
export interface RoutingMapping {
  /** Knowledge source type that triggers this mapping. */
  knowledgeType: KnowledgeSourceType;
  /** Skill name that, when present in `skills[]`, activates auto-injection. */
  skill: string;
  /** Human-readable label for the source category (used in policy text). */
  label: string;
  /** Verb phrase describing what the live skill does. */
  liveAction: string;
  /** Hint pointing the agent at the fallback cache (used in policy text). */
  fallbackHint: string;
}

export const ROUTING_REGISTRY: readonly RoutingMapping[] = [
  {
    knowledgeType: "jira",
    skill: "atlassian-readonly-skills",
    label: "Jira",
    liveAction: "query Jira issues and projects in real time",
    fallbackHint: "the materialized Jira snapshot in the knowledge cache",
  },
  {
    knowledgeType: "confluence",
    skill: "atlassian-readonly-skills",
    label: "Confluence",
    liveAction: "query Confluence pages and spaces in real time",
    fallbackHint: "the materialized Confluence snapshot in the knowledge cache",
  },
];
