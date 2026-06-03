import type { Materializer } from "./types";
import { filenameFromUrl } from "./acquire";
import { inferMaterializer } from "./materialize";

/**
 * Hints the caller can pass to influence sniffing. None are required —
 * `url` improves filename derivation, `declaredCt` is honored verbatim
 * if present (skips byte sniffing).
 */
export interface SniffHints {
  url?: string;
  declaredCt?: string;
}

/**
 * Result of content sniffing. `bytes` may differ from the input when an
 * envelope was unwrapped. `contentType` and `filename` are honest based
 * on the (possibly unwrapped) content. `materializer` is the choice the
 * existing registry would make for those hints.
 */
export interface SniffResult {
  bytes: Buffer;
  contentType: string;
  filename: string;
  materializer: Materializer;
}

/**
 * Allowlist of envelope shapes the sniffer recognizes. Each entry walks a
 * specific dot-path on the parsed JSON; if the path resolves to a string,
 * we unwrap. Order matters: more-specific shapes first (e.g. nested
 * `content.content` before plain `content`).
 */
const ENVELOPE_PATHS: ReadonlyArray<readonly string[]> = [
  ["content", "content"],
  ["content"],
  ["html"],
  ["body"],
  ["text"],
  ["markdown"],
  ["result"],
  ["data"],
];

function walkPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Try to unwrap one level of MCP-style JSON envelope. Returns the
 *  unwrapped string when a known shape applies, otherwise returns null
 *  (caller keeps the original bytes). */
function tryUnwrapEnvelope(text: string): string | null {
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  for (const path of ENVELOPE_PATHS) {
    const v = walkPath(parsed, path);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function sniffArtifact(bytes: Buffer, hints: SniffHints): SniffResult {
  const inputText = bytes.toString("utf8");
  const unwrapped = tryUnwrapEnvelope(inputText);
  const text = unwrapped ?? inputText;
  const finalBytes = unwrapped !== null ? Buffer.from(text, "utf8") : bytes;

  // Honor declared content-type if the caller passed one. We still ran
  // the unwrap because envelope detection is independent of declared CT.
  let ct = hints.declaredCt ? normalizeContentType(hints.declaredCt) : null;
  if (!ct) ct = sniffByLeadingBytes(text);

  const filename = filenameFromUrl(hints.url ?? "https://localhost/index", ct);
  const materializer = inferMaterializer({ contentType: ct, filename });

  return { bytes: finalBytes, contentType: ct, filename, materializer };
}

/** Normalize a declared content-type to one of our four canonical strings. */
function normalizeContentType(declared: string): string {
  const lower = declared.toLowerCase();
  if (lower.includes("html")) return "text/html";
  if (lower.includes("json")) return "application/json";
  if (lower.includes("markdown")) return "text/markdown";
  return "text/plain";
}

/** Sniff content type by inspecting the first non-whitespace bytes.
 *  Markdown detection deliberately conservative: a leading "#" alone is
 *  a heading, but plain text might start with "#" too — require the
 *  literal "# " (hash + space) or a YAML frontmatter `---\n` marker. */
function sniffByLeadingBytes(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return "text/plain";
  // HTML signals
  if (/^<(!doctype|html|div|article|body|section|h[1-6]|p\s|p>|table)/i.test(trimmed)) {
    return "text/html";
  }
  // JSON (re-validated by parse — leading "{" alone isn't proof)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "application/json";
    } catch {
      // fall through
    }
  }
  // Markdown: heading or frontmatter
  if (trimmed.startsWith("# ") || trimmed.startsWith("## ") || trimmed.startsWith("---\n")) {
    return "text/markdown";
  }
  return "text/plain";
}
