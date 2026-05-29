import { describe, it, expect } from "bun:test";
import { httpErrorFor } from "../../src/io/http-error";
import { SmithError } from "../../src/core/smith-error";

function makeResponse(status: number, body: string = ""): Response {
  return new Response(body, { status });
}

describe("httpErrorFor", () => {
  it("401 → permission-denied", async () => {
    const err = await httpErrorFor(makeResponse(401, "unauthorized"), {
      service: "Atlassian",
      url: "https://example.atlassian.net/wiki/api/v2/pages/1",
    });
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("permission-denied");
  });

  it("403 → permission-denied", async () => {
    const err = await httpErrorFor(makeResponse(403), {
      service: "Atlassian",
      url: "https://example.atlassian.net/x",
    });
    expect(err.payload.code).toBe("permission-denied");
  });

  it("404 → http-error with status, service, operation, snippet", async () => {
    const err = await httpErrorFor(makeResponse(404, "not found"), {
      service: "Confluence",
      url: "https://example.atlassian.net/wiki/api/v2/pages/1",
      operation: "GET page",
    });
    expect(err.payload.code).toBe("http-error");
    if (err.payload.code === "http-error") {
      expect(err.payload.status).toBe(404);
      expect(err.payload.service).toBe("Confluence");
      expect(err.payload.operation).toBe("GET page");
      expect(err.payload.snippet).toBe("not found");
    }
  });

  it("500 → http-error with snippet", async () => {
    const err = await httpErrorFor(makeResponse(500, "internal server error"), {
      service: "Jira",
      url: "https://example.atlassian.net/rest/api/3/search/jql",
      operation: "search issues",
    });
    expect(err.payload.code).toBe("http-error");
    if (err.payload.code === "http-error") {
      expect(err.payload.status).toBe(500);
      expect(err.payload.snippet).toBe("internal server error");
    }
  });

  it("snippet truncation respects snippetMaxLen", async () => {
    const long = "x".repeat(500);
    const err = await httpErrorFor(makeResponse(503, long), {
      service: "fetch",
      url: "https://example.com/",
      snippetMaxLen: 50,
    });
    if (err.payload.code === "http-error") {
      expect(err.payload.snippet?.length).toBe(50);
    }
  });

  it("snippet defaults to 200 chars", async () => {
    const long = "x".repeat(500);
    const err = await httpErrorFor(makeResponse(503, long), {
      service: "fetch",
      url: "https://example.com/",
    });
    if (err.payload.code === "http-error") {
      expect(err.payload.snippet?.length).toBe(200);
    }
  });

  it("body read failure: snippet absent, no throw", async () => {
    const res = makeResponse(500, "body");
    await res.text(); // consume
    const err = await httpErrorFor(res, {
      service: "fetch",
      url: "https://example.com/",
    });
    expect(err.payload.code).toBe("http-error");
    if (err.payload.code === "http-error") {
      expect(err.payload.snippet).toBeUndefined();
    }
  });

  it("empty body: snippet undefined", async () => {
    const err = await httpErrorFor(makeResponse(500, ""), {
      service: "fetch",
      url: "https://example.com/",
    });
    if (err.payload.code === "http-error") {
      expect(err.payload.snippet).toBeUndefined();
    }
  });

  it("permission-denied carries path: url and operation: 'read'", async () => {
    const err = await httpErrorFor(makeResponse(401), {
      service: "Atlassian",
      url: "https://example.atlassian.net/x",
    });
    if (err.payload.code === "permission-denied") {
      expect(err.payload.path).toBe("https://example.atlassian.net/x");
      expect(err.payload.operation).toBe("read");
    }
  });

  it("permission-denied threads opts.operation through (e.g. 'write')", async () => {
    const err = await httpErrorFor(makeResponse(401), {
      service: "Jira",
      url: "https://example.atlassian.net/x",
      operation: "write",
    });
    expect(err.payload.code).toBe("permission-denied");
    if (err.payload.code === "permission-denied") {
      expect(err.payload.operation).toBe("write");
    }
  });
});

describe("httpErrorFor — Theme J redaction", () => {
  it("strips userinfo from permission-denied path on 401", async () => {
    const res = new Response("auth required", { status: 401 });
    const err = await httpErrorFor(res, {
      service: "Test",
      url: "https://alice:secret@api.example.com/v1/data",
      operation: "read",
    });
    expect(err.payload.code).toBe("permission-denied");
    if (err.payload.code !== "permission-denied") throw new Error("type narrow");
    expect(err.payload.path).toBe("https://api.example.com/v1/data");
    expect(err.payload.path).not.toContain("secret");
    expect(err.payload.path).not.toContain("alice");
  });

  it("redacts query-secret values in http-error.url on 500", async () => {
    const res = new Response("server error", { status: 500 });
    const err = await httpErrorFor(res, {
      service: "Test",
      url: "https://api.example.com/v1?api_key=xxx&q=foo",
      operation: "read",
    });
    expect(err.payload.code).toBe("http-error");
    if (err.payload.code !== "http-error") throw new Error("type narrow");
    expect(err.payload.url).toBe(
      "https://api.example.com/v1?api_key=[redacted]&q=foo",
    );
    expect(err.payload.url).not.toContain("xxx");
  });
});
