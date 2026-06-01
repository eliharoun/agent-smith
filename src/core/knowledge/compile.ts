import { createHash } from "node:crypto";
import type { CompileOptions, MaterializedSource } from "./types";

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

const TOC_PREAMBLE =
  "Compiled knowledge index. Each entry points to a file under your knowledge root; read it on demand. When a (searchable: ...) hint is shown, prefer the matching MCP tool over scanning files.";

function summaryFor(s: MaterializedSource): string {
  if (s.description && s.description.length > 0) return s.description;
  return "";
}

function tocLineFor(s: MaterializedSource, summary: string): string {
  const head = s.files[0]?.relPath ?? null;
  const summaryPart = summary ? ` — ${summary}` : "";
  const targetPart = head ? ` → \`${head}\`` : "";
  const retrievalPart =
    s.retrieval?.mode && s.retrieval.mode !== "off"
      ? ` (searchable: ${s.retrieval.mode})`
      : "";
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
    const line = tocOptIn ? tocLineFor(s, summary) : null;
    return {
      source: s,
      tocLine: line,
      retrievalMode: s.retrieval?.mode ?? "off",
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
  const tocStanza =
    lines.length === 0
      ? `## Knowledge\n\n${TOC_PREAMBLE}\n\n_(no compiled knowledge sources)_`
      : `## Knowledge\n\n${TOC_PREAMBLE}\n\n${lines.join("\n")}`;

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
