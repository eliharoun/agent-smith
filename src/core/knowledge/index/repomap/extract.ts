import { loadGrammar, tagsQueryFor } from "./grammar-loader";
import type { Tag } from "./graph";

export const REPOMAP_VERSION = 1;

/** Extract def/ref tags via tree-sitter (web-tree-sitter ≥0.25 named API).
 *  Returns [] when tree-sitter or the grammar is unavailable. */
export async function extractTags(relPath: string, text: string): Promise<Tag[]> {
  const dotIdx = relPath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? relPath.slice(dotIdx) : ""; // "" for dotless names
  const wasm = await loadGrammar(ext);
  const querySrc = tagsQueryFor(ext);
  if (!wasm || !querySrc) return [];
  try {
    const { Parser, Language, Query } = await import("web-tree-sitter");
    await Parser.init();
    const language = await Language.load(wasm);
    // Parser/Tree/Query are WASM-backed (Emscripten) and are NOT reclaimed by
    // the JS GC — they must be .delete()d explicitly or the WASM heap grows
    // unbounded across a build that extracts hundreds of files. try/finally.
    const parser = new Parser();
    let tree: ReturnType<typeof parser.parse> = null;
    let query: InstanceType<typeof Query> | null = null;
    try {
      parser.setLanguage(language);
      tree = parser.parse(text);
      if (!tree) return []; // GUARD: parse() returns Tree | null
      query = new Query(language, querySrc);
      const tags: Tag[] = [];
      for (const cap of query.captures(tree.rootNode)) {
        const role = cap.name.startsWith("name.definition")
          ? "def"
          : cap.name.startsWith("name.reference")
            ? "ref"
            : null;
        if (!role) continue;
        const row = cap.node.startPosition.row;
        tags.push({
          relPath,
          name: cap.node.text,
          role,
          line: row + 1,
          signature: role === "def" ? (text.split("\n")[row] ?? "").trim().slice(0, 100) : "",
        });
      }
      return tags;
    } finally {
      tree?.delete();
      query?.delete();
      parser.delete();
    }
  } catch {
    return [];
  }
}
