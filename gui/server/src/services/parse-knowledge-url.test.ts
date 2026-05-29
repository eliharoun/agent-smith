import { expect, it } from "bun:test";
import { parseKnowledgeUrl } from "./parse-knowledge-url";

it("parses a Confluence page URL with title", () => {
  const r = parseKnowledgeUrl(
    "https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/My+Page+Title",
  );
  expect(r).toEqual({
    kind: "confluence-page",
    space: "ENG",
    pageId: "12345",
    title: "My Page Title",
  });
});

it("parses a Confluence page URL without title", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/wiki/spaces/ENG/pages/12345");
  expect(r).toEqual({ kind: "confluence-page", space: "ENG", pageId: "12345" });
});

it("parses a Confluence blog URL", () => {
  const r = parseKnowledgeUrl(
    "https://acme.atlassian.net/wiki/spaces/ENG/blog/2026/05/21/999/Post+Title",
  );
  expect(r).toEqual({
    kind: "confluence-blog",
    space: "ENG",
    postId: "999",
    title: "Post Title",
  });
});

it("parses a Confluence space URL with /overview", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/wiki/spaces/ENG/overview");
  expect(r).toEqual({ kind: "confluence-space", space: "ENG" });
});

it("parses a Confluence space URL without /overview", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/wiki/spaces/ENG");
  expect(r).toEqual({ kind: "confluence-space", space: "ENG" });
});

it("parses a Jira issue URL", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/browse/ENG-123");
  expect(r).toEqual({ kind: "jira-issue", key: "ENG-123" });
});

it("parses a Jira JQL URL", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/issues/?jql=project%20%3D%20ENG");
  expect(r).toEqual({ kind: "jira-jql", jql: "project = ENG" });
});

it("falls back to plain-url for unrecognized paths", () => {
  const r = parseKnowledgeUrl("https://example.com/some/page");
  expect(r).toEqual({ kind: "plain-url", url: "https://example.com/some/page" });
});

it("throws on non-http(s) URL", () => {
  expect(() => parseKnowledgeUrl("ftp://example.com")).toThrow();
});

it("throws on malformed URL", () => {
  expect(() => parseKnowledgeUrl("not a url")).toThrow();
});

it("space pattern does not swallow page URLs (dispatch order)", () => {
  const r = parseKnowledgeUrl("https://acme.atlassian.net/wiki/spaces/ENG/pages/1");
  expect(r.kind).toBe("confluence-page");
});
