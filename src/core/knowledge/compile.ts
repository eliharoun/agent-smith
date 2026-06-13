import { createHash } from "node:crypto";
import { isLazyUrlSource, lazyTocLine } from "./lazy-url";
import type { CompileOptions, KnowledgeSource, MaterializedSource } from "./types";

export interface CompiledKnowledge {
  /** The full `## Knowledge` section ready to be appended to the assembled body. */
  tocStanza: string;
  /** Warnings to surface to the user (truncation, missing summaries, etc.). */
  warnings: string[];
  manifest: CompileManifest;
}

export interface CompileManifest {
  schemaVersion: 1;
  /** SHA-256 over (sorted source-id list + each source's tocLine + retrieval mode). */
  contentHash: string;
  /** TOC line per source — `null` when the source opted out via `toc: false`. */
  sources: Array<{
    id: string;
    type: MaterializedSource["type"];
    relPath: string | null;
    tocLine: string | null;
    retrievalMode: "off" | "bm25" | "external-mcp";
    /** First file's sha256, used to invalidate the BM25 index. */
    contentSha?: string;
  }>;
  totals: { tocLines: number; sourcesIndexed: number; sourcesShown: number };
}

interface CompileEnv {
  /** Per-agent knowledge dir, used to render relPaths. */
  rootDir: string;
}

function tocPreamble(rootDir: string, hasLazyEntries: boolean): string {
  const lazyClause = hasLazyEntries
    ? ` \`[webpage, lazy]\` entries are NOT downloaded — fetch them at runtime when the description suggests they're relevant, using the tool listed under \`fetch via:\`. The description is your only signal until you fetch, so use it to decide.`
    : "";
  return (
    `Your knowledge root is \`${rootDir}/\`. The bullet paths below are RELATIVE ` +
    `to that root — when calling Read, prepend the root to the bullet's path. ` +
    `Each entry points at a file (single-file sources) or a directory (\`dir\`/\`glob\`/\`git\`/\`confluence\`/\`jira\`/\`web\` sources, which expand to many files under \`<root>/sources/<id>/\`). ` +
    `When a (searchable: ...) hint is shown, prefer the matching MCP tool over scanning files.` +
    lazyClause +
    ` Never reconstruct paths from memory; the bullets below are the only authoritative listing.`
  );
}

const MULTI_FILE_TYPES = new Set([
  "dir",
  "glob",
  "git",
  "confluence",
  "jira",
  "web",
]);

function summaryFor(s: MaterializedSource): string {
  if (s.description && s.description.length > 0) return s.description;
  return "";
}

function tocLineFor(
  s: MaterializedSource,
  summary: string,
  declaration?: KnowledgeSource,
): string {
  // Lazy URL: render the lazy-specific line shape using the declaration's
  // url + via, since MaterializedSource has no top-level url.
  if (declaration && isLazyUrlSource(declaration)) {
    return lazyTocLine(declaration);
  }
  const summaryPart = summary ? ` — ${summary}` : "";
  // For multi-file sources (dir/glob/git/confluence/jira/web), point at the
  // source directory `sources/<id>/` so the agent doesn't anchor on the
  // first file's path. For single-file sources (file/webpage/npm), point at
  // the materialized file directly.
  let target: string | null;
  if (MULTI_FILE_TYPES.has(s.type)) {
    const fileCount = s.files.length;
    target = `sources/${s.id}/ (${fileCount} file${fileCount === 1 ? "" : "s"})`;
  } else {
    target = s.files[0]?.relPath ?? null;
  }
  const targetPart = target ? ` → \`${target}\`` : "";
  // Default to bm25 when no `retrieval` block is set — that matches what
  // `smith knowledge serve` actually does (it indexes every materialized
  // source regardless of this field). `off` opts out of the annotation
  // explicitly; `external-mcp` carries its own routing hint.
  const effectiveMode = s.retrieval?.mode ?? "bm25";
  const retrievalPart =
    effectiveMode === "off" ? "" : ` (searchable: ${effectiveMode})`;
  return `- \`${s.id}\` [${s.type}]${summaryPart}${targetPart}${retrievalPart}`;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function compile(
  sources: MaterializedSource[],
  options: CompileOptions,
  env: CompileEnv,
): CompiledKnowledge {
  const warnings: string[] = [];
  const all = sources.map((s) => {
    const tocOptIn = s.toc !== false;
    const summary = s.summary ?? summaryFor(s);
    const declaration = options.sourceDeclarations?.[s.id];
    const line = tocOptIn ? tocLineFor(s, summary, declaration) : null;
    return {
      source: s,
      tocLine: line,
      retrievalMode: s.retrieval?.mode ?? "bm25",
      relPath: s.files[0]?.relPath ?? null,
      contentSha: s.files[0]?.sha256,
    };
  });

  // Apply tocMaxLines truncation only to lines that would render.
  const renderable = all.filter((e) => e.tocLine !== null);
  let kept: typeof renderable = renderable;
  let droppedIds: string[] = [];
  if (renderable.length > options.tocMaxLines) {
    kept = renderable.slice(0, options.tocMaxLines);
    droppedIds = renderable.slice(options.tocMaxLines).map((e) => e.source.id);
    warnings.push(
      `compile: TOC truncated at ${options.tocMaxLines} lines; dropped ids: ${droppedIds.join(", ")}`,
    );
  }

  const lines = kept.map((e) => e.tocLine).filter((s): s is string => s !== null);
  const hasLazyEntries = kept.some((e) => {
    const decl = options.sourceDeclarations?.[e.source.id];
    return decl !== undefined && isLazyUrlSource(decl);
  });
  const preamble = tocPreamble(env.rootDir, hasLazyEntries);
  const tocStanza =
    lines.length === 0
      ? `## Knowledge\n\n${preamble}\n\n_(no compiled knowledge sources)_`
      : `## Knowledge\n\n${preamble}\n\n${lines.join("\n")}`;

  const manifestSources = all.map((e) => ({
    id: e.source.id,
    type: e.source.type,
    relPath: e.relPath,
    tocLine: e.tocLine,
    retrievalMode: e.retrievalMode,
    ...(e.contentSha ? { contentSha: e.contentSha } : {}),
  }));

  // Deterministic hash: sort sources by id, fold their fields.
  const hashInput = JSON.stringify(
    [...manifestSources].sort((a, b) => a.id.localeCompare(b.id)),
  );
  const contentHash = sha256Hex(hashInput);

  return {
    tocStanza,
    warnings,
    manifest: {
      schemaVersion: 1,
      contentHash,
      sources: manifestSources,
      totals: {
        tocLines: lines.length,
        sourcesIndexed: all.length,
        sourcesShown: lines.length,
      },
    },
  };
}
