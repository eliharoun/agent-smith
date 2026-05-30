import type { AcquiredArtifact } from "../core/knowledge/acquire";
import { SmithError } from "../core/smith-error";
import {
  type AtlassianAuth,
  basicAuthHeader,
  remediationBaseUrlMissing,
  resolveAtlassianAuth,
  resolveAtlassianBaseUrl,
} from "./atlassian-auth";
import { atlassianFetch, createRequestBudget, remediationNotConfigured } from "./atlassian-http";
import { httpErrorFor } from "./http-error";

export interface JiraSearchOpts {
  /** Required JQL query string. */
  jql: string;
  /**
   * Optional list of fields to include. When omitted or empty, defaults to
   * ["summary", "description", "status"] to keep payloads small. Pass
   * ["*all"] to request every field (or pass a custom list explicitly).
   */
  fields?: string[];
  /** Default 100; hard ceiling 500 (enforced by schema). */
  maxResults?: number;
  /** Test override. */
  resolveAuth?: () => AtlassianAuth | null;
  /** Test override for env vars. */
  env?: NodeJS.ProcessEnv;
  /** Test override for fetch. */
  fetch?: typeof fetch;
}

const DEFAULT_FIELDS = ["summary", "description", "status"] as const;
const DEFAULT_MAX_RESULTS = 100;
const HARD_CEILING = 500;
const PAGE_SIZE = 100;

const REMEDIATION = remediationNotConfigured;

interface JiraIssue {
  key: string;
  fields?: Record<string, unknown>;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  nextPageToken?: string;
}

function renderIssueMarkdown(issue: JiraIssue): string {
  const f = issue.fields ?? {};
  const lines: string[] = [];
  lines.push(`# ${issue.key}`);
  const summary = typeof f["summary"] === "string" ? (f["summary"] as string) : "";
  if (summary) lines.push("", `**Summary:** ${summary}`);
  const status = (f["status"] as { name?: string } | undefined)?.name;
  if (status) lines.push("", `**Status:** ${status}`);
  const description = f["description"];
  if (typeof description === "string" && description.length > 0) {
    lines.push("", "## Description", "", description);
  }
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "summary" || k === "description" || k === "status") continue;
    extras[k] = v;
  }
  if (Object.keys(extras).length > 0) {
    lines.push("", "## Other fields", "", "```json", JSON.stringify(extras, null, 2), "```");
  }
  return lines.join("\n") + "\n";
}

export async function searchJiraIssues(opts: JiraSearchOpts): Promise<AcquiredArtifact[]> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const resolver = opts.resolveAuth ?? resolveAtlassianAuth;
  const auth = resolver();
  if (!auth) {
    throw new SmithError({
      code: "usage-error",
      message: REMEDIATION(),
    });
  }

  const budget = createRequestBudget();

  const baseUrl = resolveAtlassianBaseUrl({ env });
  if (!baseUrl) {
    throw new SmithError({
      code: "usage-error",
      message: remediationBaseUrlMissing(),
    });
  }
  const maxResults = Math.min(opts.maxResults ?? DEFAULT_MAX_RESULTS, HARD_CEILING);
  const url = `${baseUrl}/rest/api/3/search/jql`;
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const collected: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  // Default to a small, safe field set when caller didn't specify (or passed
  // []). Unbounded "all fields" responses include attachments, ADF blobs, and
  // large changelogs that explode the rendered markdown. Pass ["*all"] to opt
  // back in to the server-side default.
  const effectiveFields = opts.fields && opts.fields.length > 0 ? opts.fields : [...DEFAULT_FIELDS];

  while (collected.length < maxResults) {
    const remaining = maxResults - collected.length;
    const requestBody: Record<string, unknown> = {
      jql: opts.jql,
      maxResults: Math.min(PAGE_SIZE, remaining),
      fields: effectiveFields,
    };
    if (nextPageToken) requestBody["nextPageToken"] = nextPageToken;

    const res = await atlassianFetch(
      url,
      { method: "POST", headers, body: JSON.stringify(requestBody) },
      doFetch,
      { budget },
    );
    if (!res.ok) {
      throw await httpErrorFor(res, {
        service: "Jira",
        url,
        operation: "search issues",
      });
    }
    const body = (await res.json()) as JiraSearchResponse;
    const issues = body.issues ?? [];
    for (const issue of issues) {
      if (collected.length >= maxResults) break;
      collected.push(issue);
    }
    if (!body.nextPageToken || issues.length === 0) break;
    nextPageToken = body.nextPageToken;
  }

  return collected.map((issue) => {
    const md = renderIssueMarkdown(issue);
    const filename = `${issue.key}.md`;
    return {
      filename,
      relPath: filename,
      bytes: Buffer.from(md, "utf8"),
      contentType: "text/markdown",
    };
  });
}
