// Pure helpers for lazy URL sources. Used by the pipeline (to short-
// circuit acquire), the compile stanza renderer (to format the TOC
// entry), and the doctor section (to flag misconfigured bundles).

import type { KnowledgeSource } from "./types";

const FIRST_OR_SECOND_PERSON = /^(I |I'|you |you'|this skill|this source|this knowledge)/i;
const DESCRIPTION_MIN_CHARS = 30;
const DESCRIPTION_MAX_CHARS = 1024;

export function isLazyUrlSource(src: KnowledgeSource): boolean {
  return src.type === "url" && (src as { lazy?: boolean }).lazy === true;
}

export function lazyDescriptionWarnings(src: KnowledgeSource): string[] {
  if (!isLazyUrlSource(src)) return [];
  const warnings: string[] = [];
  const desc = src.description;
  if (!desc || desc.trim().length === 0) {
    warnings.push(
      `[${src.id}] lazy URL sources should have a description — it's the agent's only signal until it fetches the URL`,
    );
    return warnings;
  }
  if (desc.trim().length < DESCRIPTION_MIN_CHARS) {
    warnings.push(
      `[${src.id}] description is shorter than ${DESCRIPTION_MIN_CHARS} chars — write what the source contains and when to use it`,
    );
  }
  if (FIRST_OR_SECOND_PERSON.test(desc.trim())) {
    warnings.push(
      `[${src.id}] description should be written in third person (e.g. "Documents X. Use when Y.") — first/second person reduces tool-discovery accuracy`,
    );
  }
  if (desc.length > DESCRIPTION_MAX_CHARS) {
    warnings.push(
      `[${src.id}] description is longer than ${DESCRIPTION_MAX_CHARS} chars — agent runtimes may truncate; trim trigger keywords up front`,
    );
  }
  return warnings;
}

export function lazyTocLine(src: KnowledgeSource): string {
  if (!isLazyUrlSource(src)) {
    throw new Error(`lazyTocLine called on non-lazy source ${src.id}`);
  }
  const url = (src as { url: string }).url;
  const via = (src as { via?: { server: string; tool: string } }).via;
  const summaryText = (src.description ?? src.summary ?? "").trim();
  const summaryPart = summaryText ? ` — ${summaryText}` : "";
  const fetchHint = via ? `${via.server}.${via.tool}` : "WebFetch";
  return `- \`${src.id}\` [url, lazy]${summaryPart}\n    url: ${url}\n    fetch via: ${fetchHint}`;
}
