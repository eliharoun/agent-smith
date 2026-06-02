import { describe, expect, it } from "bun:test";
import {
  urlToConfluenceArgs, urlToGithubBlobArgs, urlToNotionArgs, urlToSharepointArgs,
} from "../../../src/core/knowledge/route-args";

describe("urlToConfluenceArgs", () => {
  it("extracts spaceKey + pageId", () => {
    expect(urlToConfluenceArgs("https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title"))
      .toEqual({ spaceKey: "ENG", pageId: "12345" });
  });
  it("falls back to {url} on non-matching path", () => {
    expect(urlToConfluenceArgs("https://acme.atlassian.net/wiki/x"))
      .toEqual({ url: "https://acme.atlassian.net/wiki/x" });
  });
});

describe("urlToSharepointArgs", () => {
  it("returns {url} verbatim", () => {
    expect(urlToSharepointArgs("https://acme.sharepoint.com/sites/E/Doc.docx"))
      .toEqual({ url: "https://acme.sharepoint.com/sites/E/Doc.docx" });
  });
});

describe("urlToNotionArgs", () => {
  it("extracts hex page id", () => {
    expect(urlToNotionArgs("https://www.notion.so/acme/Title-abc123def4567890abcdef0123456789a"))
      .toEqual({ pageId: "abc123def4567890abcdef0123456789a" });
  });
  it("falls back when no hex id", () => {
    expect(urlToNotionArgs("https://www.notion.so/Title-no-hex"))
      .toEqual({ url: "https://www.notion.so/Title-no-hex" });
  });
});

describe("urlToGithubBlobArgs", () => {
  it("extracts owner/repo/ref/path", () => {
    expect(urlToGithubBlobArgs("https://github.com/acme/repo/blob/main/src/x.ts"))
      .toEqual({ owner: "acme", repo: "repo", ref: "main", path: "src/x.ts" });
  });
  it("handles multi-segment paths", () => {
    expect(urlToGithubBlobArgs("https://github.com/a/b/blob/feat/x/y/z.md"))
      .toEqual({ owner: "a", repo: "b", ref: "feat", path: "x/y/z.md" });
  });
  it("falls back when not a blob URL", () => {
    expect(urlToGithubBlobArgs("https://github.com/acme/repo"))
      .toEqual({ url: "https://github.com/acme/repo" });
  });
});
