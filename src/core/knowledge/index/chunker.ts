import type { ChunkKind } from "./store";

export const CHUNKER_VERSION = 1;
const MAX_CHUNK_CHARS = 4000;
const MIN_MERGE_CHARS = 400;

export interface ChunkInput {
  relPath: string;
  text: string;
}
export interface Chunk {
  relPath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  text: string;
}

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".c",
  ".cpp",
  ".h",
]);

/** The chunk kind a path will produce, derived purely from its extension.
 *  Mirrors `chunk`'s dispatch exactly (one kind per path), so callers can route
 *  by model BEFORE chunking. .json→json, code extensions→code, everything
 *  else→prose. */
export function kindForPath(relPath: string): ChunkKind {
  const dotIdx = relPath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? relPath.slice(dotIdx) : "";
  if (ext === ".json") return "json";
  if (CODE_EXT.has(ext)) return "code";
  return "prose";
}

export async function chunk(input: ChunkInput): Promise<Chunk[]> {
  const dotIdx = input.relPath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? input.relPath.slice(dotIdx) : ""; // "" for extension-less files
  if (ext === ".json") return chunkJson(input);
  if (CODE_EXT.has(ext)) {
    const ast = await tryChunkCode(input, ext);
    if (ast && ast.length) return ast;
    return chunkProse(input).map((c) => ({
      ...c,
      kind: "code" as ChunkKind,
      text: header(input.relPath, c.startLine) + c.text,
    }));
  }
  return chunkProse(input);
}

function header(relPath: string, line: number): string {
  return `// ${relPath}:${line}\n`;
}

export function chunkProse(input: ChunkInput): Chunk[] {
  const lines = input.text.split("\n");
  const sections: { start: number; body: string[] }[] = [];
  let cur: { start: number; body: string[] } | null = null;
  lines.forEach((ln, i) => {
    if (/^#{1,6}\s/.test(ln)) {
      if (cur) sections.push(cur);
      cur = { start: i + 1, body: [ln] };
    } else {
      if (!cur) cur = { start: i + 1, body: [] };
      cur.body.push(ln);
    }
  });
  if (cur) sections.push(cur);
  const out: Chunk[] = [];
  for (const s of sections) {
    for (const piece of splitToBudget(s.body.join("\n")))
      out.push({
        relPath: input.relPath,
        startLine: s.start,
        endLine: s.start + s.body.length - 1,
        kind: "prose",
        text: piece,
      });
  }
  return out.filter((c) => c.text.trim().length > 0);
}

function chunkJson(input: ChunkInput): Chunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    return chunkProse(input).map((c) => ({ ...c, kind: "json" as ChunkKind }));
  }
  // Bare primitives (null, number, string, bool) are valid JSON but have no
  // entries; `Object.entries(null)` would throw and per-char on a string.
  // Treat them as prose so we still index the content sanely.
  if (parsed === null || typeof parsed !== "object") {
    return chunkProse(input).map((c) => ({ ...c, kind: "json" as ChunkKind }));
  }
  const total = input.text.split("\n").length;
  const entries = Array.isArray(parsed)
    ? parsed.map((v, i) => [String(i), v] as const)
    : Object.entries(parsed as Record<string, unknown>);
  const out: Chunk[] = [];
  for (const [key, value] of entries)
    for (const piece of splitToBudget(`${key}: ${JSON.stringify(value, null, 2)}`))
      out.push({ relPath: input.relPath, startLine: 1, endLine: total, kind: "json", text: piece });
  return out;
}

async function tryChunkCode(input: ChunkInput, ext: string): Promise<Chunk[] | null> {
  try {
    const { Parser, Language } = await import("web-tree-sitter");
    await Parser.init();
    const { loadGrammar } = await import("./repomap/grammar-loader");
    const wasm = await loadGrammar(ext);
    if (!wasm) return null;
    const lang = await Language.load(wasm);
    // Parser/Tree are WASM-backed and NOT GC-reclaimed — .delete() them or the
    // WASM heap grows unbounded across a build that chunks hundreds of files.
    const parser = new Parser();
    let tree: ReturnType<typeof parser.parse> = null;
    try {
      parser.setLanguage(lang);
      tree = parser.parse(input.text);
      if (!tree) return null; // GUARD: parse() returns Tree | null
      const raw: Chunk[] = [];
      for (const node of tree.rootNode.namedChildren) {
        if (!node) continue; // GUARD: namedChildren is (Node|null)[]
        const text = input.text.slice(node.startIndex, node.endIndex);
        const startLine = node.startPosition.row + 1;
        if (text.length <= MAX_CHUNK_CHARS) {
          raw.push({
            relPath: input.relPath,
            startLine,
            endLine: node.endPosition.row + 1,
            kind: "code",
            text,
          });
        } else {
          const children = node.namedChildren.filter(Boolean);
          if (children.length === 0) {
            // Oversized leaf (e.g. a huge string/comment node with no named
            // children) — split by budget so its content is not silently lost.
            for (const piece of splitToBudget(text))
              raw.push({
                relPath: input.relPath,
                startLine,
                endLine: node.endPosition.row + 1,
                kind: "code",
                text: piece,
              });
          } else {
            for (const child of children) {
              if (!child) continue; // GUARD: namedChildren is (Node|null)[]
              raw.push({
                relPath: input.relPath,
                startLine: child.startPosition.row + 1,
                endLine: child.endPosition.row + 1,
                kind: "code",
                text: input.text.slice(child.startIndex, child.endIndex),
              });
            }
          }
        }
      }
      return mergeSmall(raw, input.relPath);
    } finally {
      tree?.delete();
      parser.delete();
    }
  } catch {
    return null;
  }
}

function mergeSmall(chunks: Chunk[], relPath: string): Chunk[] {
  const out: Chunk[] = [];
  let buf: Chunk | null = null;
  for (const c of chunks) {
    const prev: Chunk | null = buf;
    if (
      prev &&
      prev.text.length + c.text.length + 1 <= MAX_CHUNK_CHARS && // +1 for the joining "\n"
      prev.text.length < MIN_MERGE_CHARS
    ) {
      const merged: Chunk = {
        relPath: prev.relPath,
        startLine: prev.startLine,
        endLine: c.endLine,
        kind: prev.kind,
        text: `${prev.text}\n${c.text}`,
      };
      buf = merged;
    } else {
      if (buf) out.push(buf);
      buf = c;
    }
  }
  if (buf) out.push(buf);
  return out.map((c) => ({ ...c, text: header(relPath, c.startLine) + c.text }));
}

function splitToBudget(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS)
    out.push(text.slice(i, i + MAX_CHUNK_CHARS));
  return out;
}
