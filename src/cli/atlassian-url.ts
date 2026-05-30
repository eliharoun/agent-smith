/**
 * Pure URL parser for `smith knowledge add <agent> <url>` shortcut.
 * Zero I/O. Returns a discriminated union describing what kind of
 * Atlassian (or plain) URL the input points at, or `null` if the input
 * is not a valid http(s) URL at all.
 *
 * See spec: docs/superpowers/specs/2026-05-16-knowledge-add-url-shortcut-design.md
 */

export type ParsedAtlassianUrl =
  | { kind: "confluence-page"; space: string; pageId: number; title: string | null }
  | { kind: "confluence-space"; space: string }
  | { kind: "confluence-blog"; space: string; postId: number; title: string | null }
  | { kind: "jira-issue"; key: string }
  | { kind: "jira-jql"; jql: string }
  | { kind: "plain-url"; url: string };

const CONFLUENCE_PAGE_RE = /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/(.+))?$/;
const CONFLUENCE_BLOG_RE = /^\/wiki\/spaces\/([^/]+)\/blog\/\d+\/\d+\/\d+\/(\d+)(?:\/(.+))?$/;
const CONFLUENCE_SPACE_RE = /^\/wiki\/spaces\/([^/]+)(?:\/overview)?\/?$/;
const JIRA_ISSUE_RE = /^\/browse\/([A-Z][A-Z0-9_]+-\d+)$/;

function decodeTitle(seg: string | undefined): string | null {
  if (!seg) return null;
  try {
    const decoded = decodeURIComponent(seg.replace(/\+/g, " "));
    return decoded.trim() === "" ? null : decoded;
  } catch {
    return null;
  }
}

export function parseAtlassianUrl(input: string): ParsedAtlassianUrl | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const path = u.pathname;

  // Dispatch order is load-bearing. CONFLUENCE_SPACE_RE is NOT
  // negative-lookahead protected — it matches any /wiki/spaces/<key>(/overview)?/?$
  // path, which would swallow page and blog URLs if it ran first. The
  // more-specific patterns (page, blog) MUST be matched before the
  // confluence-space fallback. Adding new /wiki/spaces/... shapes? Place
  // them above the mSpace block.
  const mPage = CONFLUENCE_PAGE_RE.exec(path);
  if (mPage) {
    const space = mPage[1] as string;
    const pageId = Number(mPage[2]);
    const title = decodeTitle(mPage[3]);
    return { kind: "confluence-page", space, pageId, title };
  }

  const mBlog = CONFLUENCE_BLOG_RE.exec(path);
  if (mBlog) {
    const space = mBlog[1] as string;
    const postId = Number(mBlog[2]);
    const title = decodeTitle(mBlog[3]);
    return { kind: "confluence-blog", space, postId, title };
  }

  const mSpace = CONFLUENCE_SPACE_RE.exec(path);
  if (mSpace) {
    return { kind: "confluence-space", space: mSpace[1] as string };
  }

  const mIssue = JIRA_ISSUE_RE.exec(path);
  if (mIssue) {
    return { kind: "jira-issue", key: mIssue[1] as string };
  }

  if (path === "/issues/" || path === "/issues") {
    const jql = u.searchParams.get("jql");
    if (jql && jql.trim() !== "") {
      return { kind: "jira-jql", jql };
    }
  }

  return { kind: "plain-url", url: input };
}
