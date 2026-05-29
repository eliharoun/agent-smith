import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { toMessage } from "../to-message";
import type { Materializer } from "./types";

export interface MaterializeResult {
  content: string;
  warnings: string[];
}

function bytesToString(input: Buffer | string): string {
  return typeof input === "string" ? input : input.toString("utf8");
}

function normalizeText(text: string): string {
  // Strip BOM, normalize CRLF/CR to LF.
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export function materializeHtmlToMarkdown(input: Buffer | string): MaterializeResult {
  const html = bytesToString(input);
  const warnings: string[] = [];
  const dom = new JSDOM(html, { url: "http://localhost/" });
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
  const md = turndown.turndown(mainHtml);
  return { content: normalizeText(md), warnings };
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
