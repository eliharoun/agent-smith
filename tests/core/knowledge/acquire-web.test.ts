import { describe, expect, test } from "bun:test";
import { acquireWeb, type FetchPage } from "../../../src/core/knowledge/acquire-web";

const pages: Record<string, string> = {
  "https://docs.example.com/": `<a href="/a">A</a><a href="/b">B</a><a href="https://other.com/x">ext</a>`,
  "https://docs.example.com/a": `<a href="/c">C</a> body A`,
  "https://docs.example.com/b": `body B`,
  "https://docs.example.com/c": `body C`,
};
const fetchPage: FetchPage = async (url) => {
  const body = pages[url];
  if (body === undefined) throw new Error(`404 ${url}`);
  return { bytes: Buffer.from(body, "utf8"), contentType: "text/html", url };
};

describe("acquireWeb crawl", () => {
  test("same-origin BFS bounded by maxPages", async () => {
    const { artifacts, warnings } = await acquireWeb(
      { id: "d", type: "web", url: "https://docs.example.com/", mode: "crawl", maxPages: 3, sameOrigin: true, delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    expect(artifacts.length).toBe(3);
    expect(artifacts.every((a) => a.sourceUrl!.startsWith("https://docs.example.com"))).toBe(true);
    void warnings;
  });

  test("respects include filter", async () => {
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://docs.example.com/", mode: "crawl", include: ["/a"], delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://docs.example.com/");
    expect(urls).toContain("https://docs.example.com/a");
    expect(urls).not.toContain("https://docs.example.com/b");
  });

  test("exclude filter prevents fetching matching pages", async () => {
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://docs.example.com/", mode: "crawl", exclude: ["/b"], delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://docs.example.com/");
    expect(urls).toContain("https://docs.example.com/a");
    expect(urls).not.toContain("https://docs.example.com/b");
  });

  test("depth bound: pages beyond depth are NOT fetched", async () => {
    // With depth=1, seed(0)->a(1)->c(2) — c should NOT be fetched
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://docs.example.com/", mode: "crawl", depth: 1, delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://docs.example.com/a");
    expect(urls).not.toContain("https://docs.example.com/c");
  });

  test("partial failure: 404 page is skipped with warning", async () => {
    const pagesWithBad: Record<string, string> = {
      "https://s.com/": `<a href="/ok">ok</a><a href="/bad">bad</a>`,
      "https://s.com/ok": `ok page`,
    };
    const fp: FetchPage = async (url) => {
      const body = pagesWithBad[url];
      if (body === undefined) throw new Error(`404 ${url}`);
      return { bytes: Buffer.from(body, "utf8"), contentType: "text/html", url };
    };
    const { artifacts, warnings } = await acquireWeb(
      { id: "d", type: "web", url: "https://s.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: fp },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("https://s.com/bad");
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).not.toContain("https://s.com/bad");
    expect(urls).toContain("https://s.com/ok");
  });

  test("relPath disambiguation: same path different query produce distinct relPaths", async () => {
    const pagesQ: Record<string, string> = {
      "https://q.com/": `<a href="/p?a=1">1</a><a href="/p?a=2">2</a>`,
      "https://q.com/p?a=1": `page v1`,
      "https://q.com/p?a=2": `page v2`,
    };
    const fp: FetchPage = async (url) => {
      const body = pagesQ[url];
      if (body === undefined) throw new Error(`404 ${url}`);
      return { bytes: Buffer.from(body, "utf8"), contentType: "text/html", url };
    };
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://q.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: fp },
    );
    const relPaths = artifacts.map((a) => a.relPath);
    // All relPaths must be unique (no overwrite)
    expect(new Set(relPaths).size).toBe(relPaths.length);
    // Both query-string URLs must be present
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://q.com/p?a=1");
    expect(urls).toContain("https://q.com/p?a=2");
  });
});

describe("acquireWeb crawl — non-text filtering", () => {
  /** Build a fetcher over an in-memory site that records every URL it is asked
   *  to fetch, so tests can assert a URL was never even requested. */
  function recordingFetcher(site: Record<string, { body: string; contentType?: string }>) {
    const fetched: string[] = [];
    const fetchPage: FetchPage = async (url) => {
      fetched.push(url);
      const entry = site[url];
      if (entry === undefined) throw new Error(`404 ${url}`);
      return {
        bytes: Buffer.from(entry.body, "utf8"),
        ...(entry.contentType ? { contentType: entry.contentType } : {}),
        url,
      };
    };
    return { fetched, fetchPage };
  }

  test("only follows <a> anchors — non-anchor href (link/meta) is ignored", async () => {
    // Mirrors a Wikipedia <head>: stylesheet/icon/EditURI are <link href>, not <a>.
    const { fetched: f, fetchPage } = recordingFetcher({
      "https://w.com/": {
        body:
          `<link rel="icon" href="/favicon.ico">` +
          `<link rel="stylesheet" href="/w/load.php">` +
          `<link rel="EditURI" href="/w/api.php?action=rsd">` +
          `<a href="/page">Real content link</a>`,
        contentType: "text/html",
      },
      "https://w.com/page": { body: "real content", contentType: "text/html" },
    });
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://w.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://w.com/page");
    // None of the <link> head resources should be followed or materialized.
    expect(urls).not.toContain("https://w.com/favicon.ico");
    expect(urls).not.toContain("https://w.com/w/load.php");
    expect(urls).not.toContain("https://w.com/w/api.php?action=rsd");
    // And they should never have been fetched at all.
    expect(f).not.toContain("https://w.com/favicon.ico");
    expect(f).not.toContain("https://w.com/w/load.php");
  });

  test("drops a page whose content-type is non-textual (e.g. image), with a warning", async () => {
    // /download has no asset extension, so only the content-type gate can catch it.
    const { fetched, fetchPage } = recordingFetcher({
      "https://w.com/": { body: `<a href="/download">d</a><a href="/doc">x</a>`, contentType: "text/html" },
      "https://w.com/download": { body: "\x89PNG\r\n\x1a\n binary bytes", contentType: "image/png" },
      "https://w.com/doc": { body: "real article", contentType: "text/html" },
    });
    const { artifacts, warnings } = await acquireWeb(
      { id: "d", type: "web", url: "https://w.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://w.com/doc");
    expect(urls).not.toContain("https://w.com/download");
    expect(fetched).toContain("https://w.com/download"); // it was fetched...
    expect(warnings.some((w) => w.includes("https://w.com/download"))).toBe(true); // ...then dropped with a warning
  });

  test("never fetches links with asset extensions (css/js/png/svg/woff)", async () => {
    const { fetched, fetchPage } = recordingFetcher({
      "https://w.com/": {
        body:
          `<a href="/a.css">c</a><a href="/b.js">j</a><a href="/c.png">p</a>` +
          `<a href="/d.svg">s</a><a href="/e.woff2">f</a><a href="/real">r</a>`,
        contentType: "text/html",
      },
      "https://w.com/real": { body: "real content", contentType: "text/html" },
    });
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://w.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage },
    );
    for (const asset of ["a.css", "b.js", "c.png", "d.svg", "e.woff2"]) {
      expect(fetched).not.toContain(`https://w.com/${asset}`);
    }
    expect(fetched).toContain("https://w.com/real");
    expect(artifacts.map((a) => a.sourceUrl)).toContain("https://w.com/real");
  });

  test("skips asset extensions case-insensitively (.PNG, .CSS)", async () => {
    const rec = recordingFetcher({
      "https://w.com/": { body: `<a href="/A.PNG">x</a><a href="/B.CSS">y</a><a href="/ok">o</a>`, contentType: "text/html" },
      "https://w.com/ok": { body: "ok", contentType: "text/html" },
    });
    await acquireWeb(
      { id: "d", type: "web", url: "https://w.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: rec.fetchPage },
    );
    expect(rec.fetched).not.toContain("https://w.com/A.PNG");
    expect(rec.fetched).not.toContain("https://w.com/B.CSS");
    expect(rec.fetched).toContain("https://w.com/ok");
  });

  test("content-type gate keeps non-html textual documents (markdown, json) reached via anchors", async () => {
    const rec = recordingFetcher({
      "https://w.com/": { body: `<a href="/notes">n</a><a href="/data">d</a>`, contentType: "text/html" },
      "https://w.com/notes": { body: "# notes", contentType: "text/markdown" },
      "https://w.com/data": { body: `{"k":1}`, contentType: "application/json" },
    });
    const { artifacts } = await acquireWeb(
      { id: "d", type: "web", url: "https://w.com/", mode: "crawl", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: rec.fetchPage },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://w.com/notes");
    expect(urls).toContain("https://w.com/data");
  });
});

describe("acquireWeb llms-txt", () => {
  test("resolves listed links", async () => {
    const llms: Record<string, string> = {
      "https://x.com/llms.txt": `# Docs\n- [Guide](https://x.com/guide)\n- [API](https://x.com/api)`,
      "https://x.com/guide": "guide body",
      "https://x.com/api": "api body",
    };
    const fp: FetchPage = async (url) => {
      const b = llms[url];
      if (b === undefined) throw new Error(`404 ${url}`);
      return { bytes: Buffer.from(b, "utf8"), contentType: "text/markdown", url };
    };
    const { artifacts } = await acquireWeb(
      { id: "l", type: "web", url: "https://x.com/llms.txt", mode: "llms-txt", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: fp },
    );
    const urls = artifacts.map((a) => a.sourceUrl);
    expect(urls).toContain("https://x.com/guide");
    expect(urls).toContain("https://x.com/api");
  });
});

describe("acquireWeb openapi", () => {
  test("renders endpoints to markdown", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Pet API", version: "1.0" },
      paths: { "/pets": { get: { summary: "List pets" }, post: { summary: "Create pet" } } },
    });
    const fp: FetchPage = async (url) => ({ bytes: Buffer.from(spec, "utf8"), contentType: "application/json", url });
    const { artifacts } = await acquireWeb(
      { id: "o", type: "web", url: "https://x.com/openapi.json", mode: "openapi", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: fp },
    );
    expect(artifacts.length).toBe(1);
    const md = artifacts[0]!.bytes.toString("utf8");
    expect(md).toContain("Pet API");
    expect(md).toContain("GET /pets");
    expect(md).toContain("POST /pets");
  });

  test("parses YAML openapi spec and renders markdown", async () => {
    const yaml = `openapi: 3.0.0\ninfo:\n  title: Y\npaths:\n  /z:\n    get:\n      summary: g`;
    const fp: FetchPage = async (url) => ({ bytes: Buffer.from(yaml, "utf8"), contentType: "application/yaml", url });
    const { artifacts } = await acquireWeb(
      { id: "o", type: "web", url: "https://x.com/spec.yaml", mode: "openapi", delivery: "file" },
      { cacheDir: "/tmp/x", fetchPage: fp },
    );
    const md = artifacts[0]!.bytes.toString("utf8");
    expect(md).toContain("Y");
    expect(md).toContain("GET /z");
  });
});
