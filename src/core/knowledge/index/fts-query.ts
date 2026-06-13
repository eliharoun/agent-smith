const TOKEN_RE = /[A-Za-z0-9_]+/g;
/** Tokenize a user query the same way the legacy Bm25Index does, so raw
 *  FTS5 syntax (:, ", *, -, AND/OR/NEAR) can never reach the MATCH parser.
 *
 *  Note: non-ASCII text (CJK, accented, Cyrillic, …) yields no tokens and so
 *  skips lexical search. Vector search still fires for such queries, so this
 *  is a graceful degradation rather than a dead end. */
export function ftsTokens(query: string): string[] {
  return (query.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length >= 2);
}
