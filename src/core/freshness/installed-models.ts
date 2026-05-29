import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isDebug } from "../../cli/debug-flag";
import type { PlatformId } from "../../io/platform-detect";

export interface InstalledModelsPaths {
  opencodeAgentsDir: string;
  claudeCodeAgentsDir: string;
  codexAgentsDir: string;
}

export interface InstalledModelEntry {
  platform: PlatformId;
  agent: string;
  /** Resolved model literal, or null if file has no `model:` frontmatter line. */
  model: string | null;
}

interface MdFile {
  /** Absolute path to the .md file. */
  path: string;
  /** Logical agent name (parent dir for codex layout, basename otherwise). */
  agent: string;
}

async function listMdFiles(dir: string): Promise<MdFile[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: MdFile[] = [];
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push({ path: join(dir, e.name), agent: e.name.replace(/\.md$/, "") });
      } else if (e.isDirectory()) {
        // codex layout: <dir>/<agent>/SKILL.md (or legacy <agent>/<agent>.md).
        // Agent name comes from the parent dir, NOT the file basename.
        try {
          const sub = await readdir(join(dir, e.name));
          for (const s of sub) {
            if (s.endsWith(".md")) out.push({ path: join(dir, e.name, s), agent: e.name });
          }
        } catch {
          /* skip unreadable subdir */
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

// CORE-20: this regex-based extractor is intentionally minimal.
// agent-smith-rendered frontmatter always emits `model: <id>` as a single
// line with no quoting and no block scalar, so we only support that shape.
// User-edited frontmatter that uses YAML block scalars (`model: |`,
// `model: >`), flow sequences (`model: [a, b]`), or block sequences is
// not supported. When we detect such a value we return null so the doctor
// command reports "unknown" rather than surfacing a misleading literal
// like "|" or "[opus, sonnet]". A full YAML parse would require pulling
// in a dependency just for this diagnostic; not worth it.
function extractModel(text: string, sourcePath?: string): string | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1] ?? "";
  const line = fm.split("\n").find((l) => /^model\s*:/.test(l));
  if (!line) return null;
  const colonIdx = line.indexOf(":");
  const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
  if (value === "" || /[|>[]/.test(value)) {
    if (isDebug()) {
      console.error(
        `[smith debug] frontmatter at ${sourcePath ?? "<unknown>"} appears to use ` +
          `non-canonical YAML for 'model'; doctor will report unknown`,
      );
    }
    return null;
  }
  return value;
}

export async function scanInstalledModels(
  paths: InstalledModelsPaths,
): Promise<InstalledModelEntry[]> {
  const out: InstalledModelEntry[] = [];

  for (const [platform, dir] of [
    ["opencode", paths.opencodeAgentsDir],
    ["claude-code", paths.claudeCodeAgentsDir],
    ["codex", paths.codexAgentsDir],
  ] as const) {
    const files = await listMdFiles(dir);
    for (const f of files) {
      const text = await readFile(f.path, "utf8");
      out.push({ platform, agent: f.agent, model: extractModel(text, f.path) });
    }
  }
  return out;
}
