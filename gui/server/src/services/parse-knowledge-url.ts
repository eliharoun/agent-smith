/**
 * Pure URL parser for `POST /api/knowledge/parse-url`. Mirrors the CLI
 * parser at src/cli/atlassian-url.ts:18-83. Differences:
 *   - The GUI schema (gui/shared/src/schemas/knowledge.ts) types pageId/postId
 *     as strings (preserving raw matched digits), so we DO NOT convert with
 *     Number(); we hand back the captured digits.
 *   - title is `undefined` (not present in the result object) when missing,
 *     so consumers can rely on `?.title` semantics.
 *   - Dispatch order is load-bearing — page/blog MUST come before space.
 */

import type { ParsedKnowledgeUrl } from "../../../shared/src/index";

const CONFLUENCE_PAGE_RE = /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/(.+))?$/;
const CONFLUENCE_BLOG_RE = /^\/wiki\/spaces\/([^/]+)\/blog\/\d+\/\d+\/\d+\/(\d+)(?:\/(.+))?$/;
const CONFLUENCE_SPACE_RE = /^\/wiki\/spaces\/([^/]+)(?:\/overview)?\/?$/;
const JIRA_ISSUE_RE = /^\/browse\/([A-Z][A-Z0-9_]+-\d+)$/;

function decodeTitle(seg: string | undefined): string | undefined {
  if (!seg) return undefined;
  try {
    const decoded = decodeURIComponent(seg.replace(/\+/g, " "));
    return decoded.trim() === "" ? undefined : decoded;
  } catch {
    return undefined;
  }
}

export function parseKnowledgeUrl(input: string): ParsedKnowledgeUrl {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL must be http(s)");
  }

  const path = u.pathname;

  const mPage = CONFLUENCE_PAGE_RE.exec(path);
  if (mPage) {
    const space = mPage[1] as string;
    const pageId = mPage[2] as string;
    const title = decodeTitle(mPage[3]);
    return title !== undefined
      ? { kind: "confluence-page", space, pageId, title }
      : { kind: "confluence-page", space, pageId };
  }

  const mBlog = CONFLUENCE_BLOG_RE.exec(path);
  if (mBlog) {
    const space = mBlog[1] as string;
    const postId = mBlog[2] as string;
    const title = decodeTitle(mBlog[3]);
    return title !== undefined
      ? { kind: "confluence-blog", space, postId, title }
      : { kind: "confluence-blog", space, postId };
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
