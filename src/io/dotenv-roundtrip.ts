import * as dotenv from "dotenv";

/** Parse a .env file body into a plain record. Thin wrapper over `dotenv.parse`. */
export function parseEnvFile(raw: string): Record<string, string> {
  return dotenv.parse(raw);
}

/**
 * Update or insert KEY=VALUE pairs while preserving comments, blanks, and
 * unrelated keys. Existing keys are updated in place; new keys are appended.
 *
 * A `null` value removes the key from the output (line is dropped). This
 * is a strict superset of the previous `atlassian-env.upsertEnvLines`
 * (which only accepted strings).
 *
 * Values are double-quoted iff they contain whitespace, '=', or '#'.
 * Embedded `"` and `\` are backslash-escaped.
 *
 * The output always ends with a single trailing newline.
 */
export function upsertEnvLines(raw: string, updates: Record<string, string | null>): string {
  const lines = raw.length === 0 ? [] : raw.split(/\r?\n/);
  const seen = new Set<string>();
  const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(KEY_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    const key = m[1]!;
    if (key in updates) {
      const val = updates[key];
      if (val === null) {
        // drop the line entirely
        seen.add(key);
        continue;
      }
      out.push(`${key}=${quote(val ?? "")}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, val] of Object.entries(updates)) {
    if (!seen.has(key) && val !== null) {
      out.push(`${key}=${quote(val)}`);
    }
  }
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function quote(v: string): string {
  if (/[\s#=]/.test(v)) return `"${v.replace(/(["\\])/g, "\\$1")}"`;
  return v;
}
