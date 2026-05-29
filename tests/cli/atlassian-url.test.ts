import { describe, expect, it } from "bun:test";
import { parseAtlassianUrl } from "../../src/cli/atlassian-url";

describe("parseAtlassianUrl — input validation", () => {
  it("returns null for bare garbage", () => {
    expect(parseAtlassianUrl("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAtlassianUrl("")).toBeNull();
  });

  it("returns null for ftp scheme", () => {
    expect(parseAtlassianUrl("ftp://example.com/x")).toBeNull();
  });

  it("returns null for file scheme", () => {
    expect(parseAtlassianUrl("file:///tmp/x")).toBeNull();
  });
});

describe("parseAtlassianUrl — confluence-page", () => {
  it("parses canonical Confluence page URL with title", () => {
    const r = parseAtlassianUrl(
      "https://acme.atlassian.net/wiki/spaces/SNXEXIT/pages/368024588/Power+BI+Desktop+-+Security+Model",
    );
    expect(r).toEqual({
      kind: "confluence-page",
      space: "SNXEXIT",
      pageId: 368024588,
      title: "Power BI Desktop - Security Model",
    });
  });

  it("parses Confluence page URL with no title segment", () => {
    const r = parseAtlassianUrl(
      "https://example.atlassian.net/wiki/spaces/ENG/pages/123",
    );
    expect(r).toEqual({
      kind: "confluence-page",
      space: "ENG",
      pageId: 123,
      title: null,
    });
  });

  it("decodes percent-encoded title segment", () => {
    const r = parseAtlassianUrl(
      "https://x.atlassian.net/wiki/spaces/S/pages/5/Caf%C3%A9+Notes",
    );
    expect(r).toMatchObject({ title: "Café Notes" });
  });

  it("ignores trailing query string and fragment", () => {
    const r = parseAtlassianUrl(
      "https://x.atlassian.net/wiki/spaces/S/pages/5/Notes?focusedCommentId=9#comment",
    );
    expect(r).toMatchObject({ kind: "confluence-page", pageId: 5, title: "Notes" });
  });
});

describe("parseAtlassianUrl — confluence-blog", () => {
  it("parses a Confluence blog post URL", () => {
    const r = parseAtlassianUrl(
      "https://x.atlassian.net/wiki/spaces/ENG/blog/2026/04/15/9876/Quarterly+Update",
    );
    expect(r).toEqual({
      kind: "confluence-blog",
      space: "ENG",
      postId: 9876,
      title: "Quarterly Update",
    });
  });

  it("parses a blog URL with no title segment", () => {
    const r = parseAtlassianUrl(
      "https://x.atlassian.net/wiki/spaces/ENG/blog/2026/04/15/9876",
    );
    expect(r).toEqual({ kind: "confluence-blog", space: "ENG", postId: 9876, title: null });
  });
});

describe("parseAtlassianUrl — confluence-space", () => {
  it("parses a space overview URL", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/wiki/spaces/ENG/overview")).toEqual({
      kind: "confluence-space",
      space: "ENG",
    });
  });

  it("parses a bare space URL", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/wiki/spaces/ENG")).toEqual({
      kind: "confluence-space",
      space: "ENG",
    });
  });

  it("parses a bare space URL with trailing slash", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/wiki/spaces/ENG/")).toEqual({
      kind: "confluence-space",
      space: "ENG",
    });
  });

  it("does not match space when path contains /pages/", () => {
    // Sanity: confirms ordering — page pattern wins over space pattern.
    expect(parseAtlassianUrl("https://x.atlassian.net/wiki/spaces/ENG/pages/5")).toMatchObject({
      kind: "confluence-page",
    });
  });
});

describe("parseAtlassianUrl — jira-issue", () => {
  it("parses /browse/KEY-N", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/browse/ENG-1234")).toEqual({
      kind: "jira-issue",
      key: "ENG-1234",
    });
  });

  it("parses /browse/KEY-N with multi-segment project key", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/browse/AB1_CD-7")).toEqual({
      kind: "jira-issue",
      key: "AB1_CD-7",
    });
  });

  it("does not match lowercase project keys", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/browse/eng-1234")).toMatchObject({
      kind: "plain-url",
    });
  });

  it("does not match /browse/ with no key", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/browse/")).toMatchObject({
      kind: "plain-url",
    });
  });
});

describe("parseAtlassianUrl — jira-jql", () => {
  it("parses /issues/?jql=...", () => {
    const r = parseAtlassianUrl(
      "https://x.atlassian.net/issues/?jql=project%20%3D%20ENG%20AND%20status%20%3D%20Open",
    );
    expect(r).toEqual({
      kind: "jira-jql",
      jql: "project = ENG AND status = Open",
    });
  });

  it("falls through to plain-url when jql param is empty", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/issues/?jql=")).toMatchObject({
      kind: "plain-url",
    });
  });

  it("falls through to plain-url when /issues/ has no jql param", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/issues/")).toMatchObject({
      kind: "plain-url",
    });
  });
});

describe("parseAtlassianUrl — plain-url fallback", () => {
  it("returns plain-url for any other http URL", () => {
    expect(parseAtlassianUrl("https://example.com/docs/intro")).toEqual({
      kind: "plain-url",
      url: "https://example.com/docs/intro",
    });
  });

  it("returns plain-url for an Atlassian URL with an unrecognised shape (e.g. tinylink)", () => {
    expect(parseAtlassianUrl("https://x.atlassian.net/wiki/x/ABCDEF")).toMatchObject({
      kind: "plain-url",
    });
  });

  it("returns plain-url for the newer Jira issue path (out of v1 scope)", () => {
    expect(
      parseAtlassianUrl("https://x.atlassian.net/jira/software/projects/ENG/issues/ENG-1"),
    ).toMatchObject({ kind: "plain-url" });
  });

  it("preserves the original URL string verbatim (including query and fragment)", () => {
    expect(
      parseAtlassianUrl("https://example.com/x?y=1#z"),
    ).toEqual({ kind: "plain-url", url: "https://example.com/x?y=1#z" });
  });
});
