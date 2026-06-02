import type { CompiledKnowledge } from "./knowledge/compile";
import type { KnowledgeSection } from "./knowledge/types";
import { ROUTING_REGISTRY } from "./knowledge/skill-routing-registry";

export interface AssemblerInput {
  identity: string;
  expertise: string;
  soul: string;
  user: string;
}

export interface SkillsSection {
  skills: string[];
  descriptions: Map<string, string>;
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

function clean(block: string): string {
  return block.replace(FRONTMATTER_RE, "").replace(/\s+$/g, "");
}

const SKILLS_PREAMBLE =
  "You have access to these skills and should invoke them when their description matches your task:";

function renderSkillsSection({ skills, descriptions }: SkillsSection): string {
  const bullets = skills.map((name) => {
    const desc = descriptions.get(name);
    return desc ? `- \`${name}\` — ${desc}` : `- \`${name}\``;
  });
  return `## Default Skills\n\n${SKILLS_PREAMBLE}\n\n${bullets.join("\n")}`;
}

const KNOWLEDGE_INLINE_PREAMBLE =
  "You have the following domain knowledge available. Treat it as authoritative for the topics it covers.";
const KNOWLEDGE_INDEX_PREAMBLE_BASE =
  "The complete list of files in your knowledge directory follows. Apply the Knowledge Discipline rules above before reading any of them.";

const KNOWLEDGE_DISCIPLINE_RULES = [
  "Before answering any question that might be covered by your knowledge:",
  "",
  "1. Scan the Knowledge Index for matching bullets.",
  "2. Read matching files with the Read tool, using the EXACT path from the bullet prepended with your knowledge root.",
  "3. Only after reading, answer. When you cite a fact from a knowledge file, include the bullet path you read.",
  "",
  "Hard rules:",
  "",
  "- Never reconstruct a knowledge path from a source id, slug, or your memory of earlier conversations. File paths have the shape `sources/<source-id>/<page-id>-<slug>.md` — the source id is a directory, not a filename, and there is no flat layout.",
  "- If a topic is not in the index, say so plainly. Do not guess a path and try it.",
  "- Narrating \"let me check the index\" is fine. Stating a fact before reading the relevant file is not.",
].join("\n");

function knowledgeDisciplinePreamble(rootDir: string | undefined): string {
  const base =
    "You have a Knowledge Index below listing every file you can read in your knowledge directory. The index is the only authoritative list. Files not in the index do not exist.";
  if (!rootDir) return base;
  return `${base} Your knowledge root is \`${rootDir}/\` — every bullet path in the index is relative to this root, and the Read tool needs the absolute path (root + bullet).`;
}

function knowledgeIndexPreamble(
  rootDir: string | undefined,
  hasGitSources: boolean,
): string {
  if (!rootDir) return KNOWLEDGE_INDEX_PREAMBLE_BASE;
  const rootPara = `These files live under \`${rootDir}/\`. The bullet paths below are relative to that root — prepend it when calling \`Read\`.`;
  if (!hasGitSources) {
    return `${KNOWLEDGE_INDEX_PREAMBLE_BASE}\n\n${rootPara}`;
  }
  const gitPara = `Additionally, for each \`type: git\` knowledge source, the full repository checkout is available at \`${rootDir}/repos/<source-id>/\`. The bullets below show only the curated subset materialized under \`sources/\`; if you need other files from a repo (e.g., source code in \`src/\`, tests, configs not matched by the include patterns), read them directly from \`${rootDir}/repos/<source-id>/\`. List the git sources with \`ls ${rootDir}/repos/\`.`;
  return `${KNOWLEDGE_INDEX_PREAMBLE_BASE}\n\n${rootPara}\n\n${gitPara}`;
}

function renderKnowledgeInline(section: KnowledgeSection): string | undefined {
  if (section.inline.length === 0) return undefined;
  const parts = section.inline.map((s) => {
    const heading = s.description ? `### ${s.id} — ${s.description}` : `### ${s.id}`;
    return `${heading}\n\n${s.content.trimEnd()}`;
  });
  return `## Knowledge\n\n${KNOWLEDGE_INLINE_PREAMBLE}\n\n${parts.join("\n\n")}`;
}

function renderKnowledgeDiscipline(section: KnowledgeSection): string | undefined {
  if (section.index.length === 0) return undefined;
  return `## Knowledge Discipline\n\n${knowledgeDisciplinePreamble(section.rootDir)}\n\n${KNOWLEDGE_DISCIPLINE_RULES}`;
}

function renderKnowledgeIndex(section: KnowledgeSection): string | undefined {
  if (section.index.length === 0) return undefined;
  const bullets = section.index.map((e) => {
    const tail = e.summary ?? e.description ?? "";
    return tail ? `- ${e.relPath} — ${tail}` : `- ${e.relPath}`;
  });
  return `## Knowledge Index\n\n${knowledgeIndexPreamble(section.rootDir, section.hasGitSources ?? false)}\n\n${bullets.join("\n")}`;
}

function renderToolRoutingPolicy(
  skillsSection: SkillsSection | undefined,
  knowledgeSection: KnowledgeSection | undefined,
): string | undefined {
  if (!skillsSection || skillsSection.skills.length === 0) return undefined;
  if (!knowledgeSection) return undefined;
  const types = knowledgeSection.sourceTypes;
  if (!types || types.size === 0) return undefined;
  const declared = new Set(skillsSection.skills);
  const matched = ROUTING_REGISTRY.filter(
    (m) => types.has(m.knowledgeType) && declared.has(m.skill),
  );
  if (matched.length === 0) return undefined;

  const rules = matched.map(
    (m) =>
      `For **any ${m.label} question**:\n\n` +
      `1. **First**, invoke the \`${m.skill}\` skill to ${m.liveAction}. The cache is always a point-in-time snapshot.\n` +
      `2. **Fall back** to ${m.fallbackHint} only if the live call fails or the user explicitly requests the cached snapshot. Mark fallback answers as "from cached snapshot, may be stale."`,
  );

  const rationale =
    "Live tools are authoritative; the cached snapshot is a navigation aid that drifts between rebuilds. When a live skill is declared for a knowledge type, prefer it for any freshness-sensitive question and reach for the cache only as a labelled fallback.";

  return `## Tool Routing Policy\n\n${rules.join("\n\n")}\n\n${rationale}`;
}

/**
 * Combines the four agent source files into a single markdown body.
 * Order: IDENTITY -> EXPERTISE -> SOUL -> USER -> [ROUTING] -> KNOWLEDGE -> SKILLS.
 *
 * Knowledge sits between USER and SKILLS by design: it is domain context the
 * agent should weight highly, but should not outrank persona/voice. Skills are
 * invoked tools, so they come last. The optional ROUTING block sits
 * immediately before KNOWLEDGE so the agent reads "prefer live over cache"
 * right before being told what cached knowledge exists.
 */
export function assembleBody(
  input: AssemblerInput,
  skillsSection?: SkillsSection,
  knowledgeSection?: KnowledgeSection,
  compiledKnowledge?: CompiledKnowledge,
): string {
  const blocks: string[] = [
    clean(input.identity),
    clean(input.expertise),
    clean(input.soul),
    clean(input.user),
  ];
  const routing = renderToolRoutingPolicy(skillsSection, knowledgeSection);
  if (routing) blocks.push(routing);
  if (compiledKnowledge) {
    // v2.0: progressive disclosure replaces the v1 inline + discipline + index trio.
    blocks.push(compiledKnowledge.tocStanza);
  } else if (knowledgeSection) {
    const inline = renderKnowledgeInline(knowledgeSection);
    if (inline) blocks.push(inline);
    const discipline = renderKnowledgeDiscipline(knowledgeSection);
    if (discipline) blocks.push(discipline);
    const index = renderKnowledgeIndex(knowledgeSection);
    if (index) blocks.push(index);
  }
  if (skillsSection && skillsSection.skills.length > 0) {
    blocks.push(renderSkillsSection(skillsSection));
  }
  return `${blocks.join("\n\n---\n\n")}\n`;
}
