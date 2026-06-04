import { JSDOM } from "jsdom";

/** Minimum byte length for an inner element's content to be considered a
 *  document worth swapping in. Below this, it's almost certainly an
 *  inline form widget rather than an embedded source document. The
 *  threshold is generous because the HTML5 parser strips `<html>` and
 *  `<body>` wrapper bytes when an embedded document lives inside a
 *  non-raw-text container (`<pre>`, `<code>`); we need to match the
 *  surviving inner serialisation. */
const MIN_INNER_BYTES = 400;

/** Shape-tier: inner must be at least this many times larger than the
 *  outer body's text content (excluding the inner element) before we
 *  swap. The load-bearing heuristic — guarantees we only unwrap when
 *  the embedded element holds the bulk of the page's information. */
const SHAPE_SIZE_RATIO = 2;

/** Tier-1 class-name keywords. Case-insensitive substring match against
 *  the element's `class` attribute. Names are deliberately generic —
 *  authors that mark embedded content with these idioms get reliable
 *  unwrap; specific tools/platforms don't appear in the list. */
const CLASS_SIGNALS: ReadonlyArray<string> = [
  "wiki-code",
  "source-code",
  "raw-content",
  "embedded-content",
  "wiki-source",
  "source-content",
];

/** Selectors for elements that can carry embedded source content. The
 *  common case is `<textarea>` (form-field; turndown skips it entirely);
 *  others appear in static-HTML wrappers and template islands. */
const CANDIDATE_SELECTOR = 'textarea, pre, code, script[type="text/template"], noscript';

/** Tag names that the HTML parser treats as raw-text containers — their
 *  contents survive as a single text node, so `textContent` round-trips
 *  the original source. Elements outside this set (`<pre>`, `<code>`)
 *  parse children normally; for those we use `innerHTML` so an embedded
 *  document survives whether it was stored as HTML-encoded entities or
 *  as raw markup. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["textarea", "script", "noscript"]);

/** Read the embedded source text out of a candidate element, picking
 *  the right accessor for the element's parser semantics. */
function readEmbeddedSource(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (RAW_TEXT_TAGS.has(tag)) return el.textContent ?? "";
  // For non-raw-text containers, `innerHTML` faithfully reflects what
  // was stored (re-serialising parsed nodes or decoding entities).
  const inner = el.innerHTML ?? "";
  if (inner.length > 0) return inner;
  return el.textContent ?? "";
}

/** HTML markers we recognise at the start of trimmed inner content. If
 *  trimmed text starts with one of these (after stripping a leading
 *  HTML comment), the content is HTML-shaped. Includes both document
 *  roots (`html`, `body`, `!doctype`) and common content roots
 *  (`p`, `ul`, `table`, …) — when an embedded source is hosted inside
 *  a non-raw-text element, the HTML5 parser silently hoists `<html>`
 *  and `<body>` tags out, leaving the first body-level child element
 *  as the visible prefix. */
const HTML_LEADING_RE =
  /^<(!doctype|html|body|div|section|article|main|h[1-6]|p|ul|ol|table|pre|code|span|figure|blockquote)\b/i;

/** Strip a single leading HTML comment block (if any) from `text`, then
 *  trim. Many embedded-source tools prepend a "DO NOT EDIT" comment to
 *  the inner content, which would otherwise foil our HTML detection. */
function stripLeadingComment(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("<!--")) return trimmed;
  const end = trimmed.indexOf("-->");
  if (end < 0) return trimmed;
  return trimmed.slice(end + 3).trimStart();
}

function looksLikeHtmlDocument(text: string): boolean {
  const stripped = stripLeadingComment(text);
  return HTML_LEADING_RE.test(stripped);
}

function hasClassSignal(classAttr: string): boolean {
  const lower = classAttr.toLowerCase();
  for (const needle of CLASS_SIGNALS) {
    if (lower.includes(needle)) return true;
  }
  return false;
}

/**
 * Detect a content-bearing HTML element (`<textarea>`, `<pre>`, etc.)
 * whose text value is the real document, with the surrounding HTML
 * being only a transport wrapper. Used by the materializer pipeline
 * BEFORE wiki-platform detection so the dispatcher sees the correct
 * bytes.
 *
 * Two-tier algorithm:
 *   1. Class signal — element's class contains a generic content-bearing
 *      idiom (`wiki-code`, `source-code`, `raw-content`, etc.). Authors
 *      explicitly marked the element; trust it.
 *   2. Shape fallback — no class match. Look for an element whose
 *      content (a) starts with HTML doctype/tag markers and (b) is at
 *      least 2x the size of the outer body's other content. The size
 *      ratio is what distinguishes "the page IS this textarea" from
 *      "this textarea is an inline widget".
 *
 * Returns the unwrapped HTML string when a match applies, otherwise
 * null (caller keeps the original bytes).
 */
export function tryUnwrapEmbeddedHtml(html: string): string | null {
  if (!html || html.length === 0) return null;
  let dom: JSDOM;
  try {
    dom = new JSDOM(html);
  } catch {
    return null;
  }
  const doc = dom.window.document;
  const candidates = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR));
  if (candidates.length === 0) return null;

  // Tier 1: class signal.
  for (const el of candidates) {
    const classAttr = el.getAttribute("class") ?? "";
    if (!hasClassSignal(classAttr)) continue;
    const inner = readEmbeddedSource(el).trim();
    if (inner.length < MIN_INNER_BYTES) continue;
    if (!looksLikeHtmlDocument(inner)) continue;
    return inner;
  }

  // Tier 2: shape fallback.
  const bodyTextLength = (doc.body?.textContent ?? "").trim().length;
  for (const el of candidates) {
    const inner = readEmbeddedSource(el).trim();
    if (inner.length < MIN_INNER_BYTES) continue;
    if (!looksLikeHtmlDocument(inner)) continue;
    // Compare using textContent lengths so both sides are measured the
    // same way (inner source may be `innerHTML` for `<pre>`/`<code>`,
    // which inflates byte counts vs. the body's textContent).
    const innerTextLength = (el.textContent ?? "").trim().length;
    const outerOtherLength = bodyTextLength - innerTextLength;
    if (outerOtherLength < 0) continue;
    if (innerTextLength < outerOtherLength * SHAPE_SIZE_RATIO) continue;
    return inner;
  }

  return null;
}
