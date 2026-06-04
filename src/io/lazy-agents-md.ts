import type { KnowledgeBlock, KnowledgeSource } from "../core/knowledge/types";
import { isLazyUrlSource } from "../core/knowledge/lazy-url";

export interface RenderLazyAgentsMdOpts {
  /** Override the global fetcher. Default: global fetch. */
  fetchFn?: (url: string) => Promise<string>;
}

/** Returns the subset of `block.sources` that are lazy URL sources. */
export function collectLazyUrlSources(block: KnowledgeBlock | undefined): KnowledgeSource[] {
  if (!block?.sources) return [];
  return block.sources.filter((s) => isLazyUrlSource(s));
}

/**
 * Fetch each lazy URL source and render a "## Lazy URL Sources" markdown
 * section to append to the agents-md body. Returns undefined when there are
 * no lazy sources to render.
 *
 * Per-source format:
 *   ### <id> — <description>
 *
 *   > source: <url>
 *
 *   <fetched body>
 *
 * On fetch failure: the section still emits the heading + a warning line so
 * authors and recipients can see what went wrong without breaking install.
 */
export async function renderLazyAgentsMdSection(
  block: KnowledgeBlock | undefined,
  opts: RenderLazyAgentsMdOpts = {},
): Promise<string | undefined> {
  const lazySources = collectLazyUrlSources(block);
  if (lazySources.length === 0) return undefined;

  const fetchFn = opts.fetchFn ?? defaultFetch;
  const parts: string[] = ["## Lazy URL Sources", ""];

  for (const src of lazySources) {
    const url = (src as { url: string }).url;
    const heading = src.description ? `### ${src.id} — ${src.description}` : `### ${src.id}`;
    parts.push(heading, "", `> source: ${url}`, "");
    try {
      const body = await fetchFn(url);
      parts.push(body.trimEnd(), "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parts.push(`*fetch failed: ${message}*`, "");
    }
  }

  return parts.join("\n");
}

async function defaultFetch(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return await resp.text();
}
