/** The ONE place that knows grammar WASM + tags.scm layout. Returns null when
 *  the grammar package is unavailable → code chunking & repo-map degrade. */
const EXT_TO_NAME: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
};

export async function loadGrammar(ext: string): Promise<string | null> {
  const name = EXT_TO_NAME[ext];
  if (!name) return null;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    return require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`);
  } catch {
    return null;
  }
}

/** tags.scm query string per language. Minimal viable set; expand later. */
export function tagsQueryFor(ext: string): string | null {
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext))
    return `
      (function_declaration name: (identifier) @name.definition.function)
      (method_definition name: (property_identifier) @name.definition.method)
      (class_declaration name: (type_identifier) @name.definition.class)
      (call_expression function: (identifier) @name.reference.call)
    `;
  if (ext === ".py")
    return `
      (function_definition name: (identifier) @name.definition.function)
      (class_definition name: (identifier) @name.definition.class)
      (call function: (identifier) @name.reference.call)
    `;
  return null;
}
