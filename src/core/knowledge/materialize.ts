import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
// @ts-expect-error — no types shipped, but the API is documented and stable
import { gfm } from "turndown-plugin-gfm";
import { toMessage } from "../to-message";
import { prependFrontmatter } from "./frontmatter";
import type { Materializer } from "./types";
import {
  contentRootSelector,
  detectWikiPlatform,
  noiseSelectors,
  type WikiPlatform,
} from "./wiki-platform";

export interface MaterializeResult {
  content: string;
  warnings: string[];
}

function bytesToString(input: Buffer | string): string {
  return typeof input === "string" ? input : input.toString("utf8");
}

function normalizeText(text: string): string {
  // Strip BOM, normalize CRLF/CR to LF.
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function materializePassthrough(input: Buffer | string): MaterializeResult {
  return { content: normalizeText(bytesToString(input)), warnings: [] };
}

export function materializeJson(input: Buffer | string): MaterializeResult {
  const raw = bytesToString(input);
  try {
    const parsed = JSON.parse(raw);
    return { content: JSON.stringify(parsed, null, 2), warnings: [] };
  } catch (err) {
    return {
      content: normalizeText(raw),
      warnings: [`json materializer: invalid JSON, falling back to passthrough (${toMessage(err)})`],
    };
  }
}

/** Build a fresh TurndownService with GFM (tables, strikethrough,
 *  task-list items) loaded. Per-call construction (rather than module-level
 *  singleton) keeps any future per-call configuration from leaking between
 *  invocations. */
function makeTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  td.use(gfm);
  return td;
}

/**
 * Dispatch HTML to either wiki-mode (turndown+GFM directly on the wiki
 * content root) or article-mode (Readability + turndown + GFM). The
 * decision is deterministic from a substring scan of the HTML head/body.
 *
 * `url` is required so JSDOM can resolve relative links against the real
 * source URL.
 */
export function materializeHtml(html: string, url: string): MaterializeResult {
  const platform = detectWikiPlatform(html);
  return platform != null
    ? materializeWikiHtml(html, url, platform)
    : materializeArticleHtml(html, url);
}

/**
 * Wiki-mode materializer: the wiki backend has already stripped chrome
 * server-side, so the right move is to find the wiki content root, strip
 * a few platform-specific noise elements, and run turndown directly.
 * Running an extractor like Readability on already-extracted content
 * only loses information.
 */
export function materializeWikiHtml(
  html: string,
  url: string,
  platform: WikiPlatform,
): MaterializeResult {
  const warnings: string[] = [];
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const rootSelector = contentRootSelector(platform);
  const root = doc.querySelector(rootSelector) ?? doc.body;
  if (root === doc.body) {
    warnings.push(`wiki materializer: content root selector "${rootSelector}" did not match; falling back to <body>`);
  }
  for (const sel of noiseSelectors(platform)) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      el.remove();
    }
  }
  const md = makeTurndown().turndown(root.innerHTML);
  const title = pickTitle(doc, root, url);
  const content = prependFrontmatter(normalizeText(md), {
    title,
    source_url: url,
    fetched_at: new Date().toISOString(),
  });
  return { content, warnings };
}

/**
 * Article-mode materializer: Readability + turndown + GFM. JSDOM seeded
 * with the real `url` so relative links resolve correctly.
 */
export function materializeArticleHtml(html: string, url: string): MaterializeResult {
  const warnings: string[] = [];
  const dom = new JSDOM(html, { url });
  let mainHtml = "";
  try {
    const article = new Readability(dom.window.document).parse();
    mainHtml = article?.content ?? "";
  } catch (err) {
    warnings.push(`readability extraction failed: ${toMessage(err)}`);
  }
  if (!mainHtml) {
    warnings.push("readability returned no main content; converting full body");
    mainHtml = dom.window.document.body?.innerHTML ?? html;
  }
  const md = makeTurndown().turndown(mainHtml);
  const title = pickTitle(dom.window.document, null, url);
  const content = prependFrontmatter(normalizeText(md), {
    title,
    source_url: url,
    fetched_at: new Date().toISOString(),
  });
  return { content, warnings };
}

/**
 * Back-compat alias: the old export name still works for in-tree callers
 * (acquire-source.ts) that haven't been migrated yet. Uses a placeholder
 * URL — links won't resolve correctly, but structure is preserved. New
 * code should call `materializeHtml(html, url)`.
 */
export function materializeHtmlToMarkdown(input: Buffer | string): MaterializeResult {
  return materializeHtml(bytesToString(input), "https://localhost/");
}

/** Pick a title in priority order: <title>, contained <h1>, beautified URL slug. */
function pickTitle(doc: Document, contentRoot: Element | null, url: string): string {
  const titleEl = doc.querySelector("title");
  if (titleEl?.textContent && titleEl.textContent.trim().length > 0) {
    return titleEl.textContent.trim();
  }
  const root = contentRoot ?? doc.body;
  const h1 = root?.querySelector("h1");
  if (h1?.textContent && h1.textContent.trim().length > 0) {
    return h1.textContent.trim();
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return last.replace(/[-_]+/g, " ").replace(/\.[a-z]{2,5}$/i, "");
  } catch {
    // fall through
  }
  return "";
}

const EXT_MATERIALIZER: Record<string, Materializer> = {
  ".md": "passthrough",
  ".markdown": "passthrough",
  ".txt": "passthrough",
  ".json": "json",
  ".html": "html-to-md",
  ".htm": "html-to-md",
  ".pdf": "pdf-extract",
};

const CT_MATERIALIZER: { match: RegExp; m: Materializer }[] = [
  { match: /^text\/html\b/i, m: "html-to-md" },
  { match: /^application\/json\b/i, m: "json" },
  { match: /^application\/pdf\b/i, m: "pdf-extract" },
  { match: /^text\/markdown\b/i, m: "passthrough" },
  { match: /^text\//i, m: "passthrough" },
];

export function inferMaterializer(hint: { filename?: string; contentType?: string }): Materializer {
  if (hint.contentType) {
    for (const { match, m } of CT_MATERIALIZER) if (match.test(hint.contentType)) return m;
  }
  if (hint.filename) {
    const dot = hint.filename.lastIndexOf(".");
    if (dot >= 0) {
      const ext = hint.filename.slice(dot).toLowerCase();
      const m = EXT_MATERIALIZER[ext];
      if (m) return m;
    }
  }
  return "passthrough";
}
