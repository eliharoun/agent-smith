export interface FrontmatterFields {
  title?: string;
  source_url?: string;
  fetched_at?: string;
}

/**
 * Prepend a YAML frontmatter block to a markdown body. Fields
 * whose value is undefined or "" are skipped — so a partially-known
 * source still produces a clean header. When no fields apply, the
 * content is returned unchanged (no header, no leading blank line).
 *
 * Quoted scalar style is used unconditionally so titles with colons,
 * leading dashes, or other YAML-significant characters round-trip
 * safely. Embedded double-quotes are backslash-escaped.
 */
export function prependFrontmatter(
  content: string,
  fields: FrontmatterFields
): string {
  const lines: string[] = [];
  if (fields.title && fields.title.length > 0)
    lines.push(`title: "${escape(fields.title)}"`);
  if (fields.source_url && fields.source_url.length > 0) {
    lines.push(`source_url: "${escape(fields.source_url)}"`);
  }
  if (fields.fetched_at && fields.fetched_at.length > 0) {
    lines.push(`fetched_at: "${escape(fields.fetched_at)}"`);
  }
  if (lines.length === 0) return content;
  return `---\n${lines.join("\n")}\n---\n\n${content}`;
}

function escape(value: string): string {
  return value.replace(/"/g, '\\"');
}
