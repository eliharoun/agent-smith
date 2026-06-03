export type WikiPlatform = "xwiki" | "confluence" | "mediawiki" | "sharepoint";

/** Cap the substring search at 8KB so the dispatcher stays cheap when
 *  every direct-HTTP HTML page passes through it. Wiki signals always
 *  appear in the document head or top of body — well within 8KB. */
const SCAN_LIMIT_BYTES = 8 * 1024;

/**
 * Cheap substring-match dispatcher. Order is significant: when a page
 * could match more than one platform (rare), the first match wins —
 * specifically XWiki before Confluence handles XWiki sites that ship
 * AUI styling.
 */
const SIGNATURES: ReadonlyArray<{ platform: WikiPlatform; needles: ReadonlyArray<string> }> = [
  {
    platform: "xwiki",
    needles: [
      'class="xwikicontent"',
      "class='xwikicontent'",
      'class="xwikicontent ',
      "class='xwikicontent ",
      'name="generator" content="XWiki',
    ],
  },
  {
    platform: "confluence",
    needles: [
      'id="confluence-content"',
      'class="aui-page-panel"',
      'id="main-content"',
      'class="confluence-information-macro"',
    ],
  },
  {
    platform: "mediawiki",
    needles: [
      'class="mw-parser-output"',
      "class='mw-parser-output'",
      'class="mw-parser-output ',
      'name="generator" content="MediaWiki',
    ],
  },
  {
    platform: "sharepoint",
    needles: [
      'class="ms-rtestate-field"',
      'class="ms-CommandBar"',
    ],
  },
];

export function detectWikiPlatform(html: string): WikiPlatform | null {
  if (html.length === 0) return null;
  const haystack = html.length > SCAN_LIMIT_BYTES ? html.slice(0, SCAN_LIMIT_BYTES) : html;
  for (const { platform, needles } of SIGNATURES) {
    for (const needle of needles) {
      if (haystack.includes(needle)) return platform;
    }
  }
  return null;
}

/** Per-platform CSS selector that locates the wiki content root inside a
 *  parsed Document. Used by `materializeWikiHtml` after JSDOM parses the
 *  HTML. Returns the first matching selector or undefined when the
 *  caller should fall back to `document.body`. */
export function contentRootSelector(platform: WikiPlatform): string {
  switch (platform) {
    case "xwiki":
      return ".xwikicontent";
    case "confluence":
      return "#confluence-content, #main-content";
    case "mediawiki":
      return ".mw-parser-output";
    case "sharepoint":
      return ".ms-rtestate-field";
  }
}

/** Per-platform set of CSS selectors to remove from the content root
 *  before turndown runs. These are noisy chrome elements that the
 *  platform doesn't include in its server-rendered "content area" but
 *  occasionally bleed in (edit-section anchors, breadcrumbs, etc.). */
export function noiseSelectors(platform: WikiPlatform): readonly string[] {
  switch (platform) {
    case "xwiki":
      return ["#xwikiintro", ".panel.xwikiintro"];
    case "confluence":
      return [".aui-page-panel-nav", ".toolbar", ".breadcrumb"];
    case "mediawiki":
      return [".mw-editsection", ".navigation-not-searchable", ".reference"];
    case "sharepoint":
      return [".ms-CommandBar", ".ms-FocusZone"];
  }
}
