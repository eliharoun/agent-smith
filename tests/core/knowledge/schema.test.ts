import { describe, expect, it, test } from "bun:test";
import { KnowledgeBlockSchema, KnowledgeSourceSchema } from "../../../src/core/knowledge/schema";

describe("KnowledgeSourceSchema", () => {
  it("accepts a minimal file source with delivery", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "schema",
      type: "file",
      path: "./db/schema.sql",
      delivery: "inline",
    });
    expect(r.success).toBe(true);
  });

  it("rejects file source without path", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "schema",
      type: "file",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("type=file requires path"))).toBe(true);
    }
  });

  it("rejects url source without url", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      delivery: "auto",
    });
    expect(r.success).toBe(false);
  });

  it("rejects url field on type=file", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "file",
      path: "./a.txt",
      url: "https://example.com",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // CORE-1: cross-type field rejection now structural via z.discriminatedUnion
      // + .strict(); message format is "Unrecognized key: \"url\"" (or similar)
      // rather than the old custom wording. Verify the field name is surfaced.
      expect(
        r.error.issues.some(
          (i) => i.message.toLowerCase().includes("url") || i.path.includes("url"),
        ),
      ).toBe(true);
    }
  });

  it("rejects url field on type=dir", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "dir",
      path: "./d",
      url: "https://example.com",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
  });

  it("rejects url field on type=glob", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "glob",
      path: "./*.md",
      url: "https://example.com",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
  });

  it("rejects url field on type=npm", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "npm",
      package: "foo",
      url: "https://example.com",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-kebab id", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "Not_Kebab",
      type: "file",
      path: "./x.md",
      delivery: "inline",
    });
    expect(r.success).toBe(false);
  });

  it("rejects extractor without materialize=pdf-extract", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "file",
      path: "./x.pdf",
      delivery: "file",
      extractor: "pdf-parse",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("extractor only valid"))).toBe(true);
    }
  });

  it("accepts inlineBudgetTokens up to 16000", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "file",
      path: "./x.md",
      delivery: "inline",
      inlineBudgetTokens: 16000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects inlineBudgetTokens > 16000", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "file",
      path: "./x.md",
      delivery: "inline",
      inlineBudgetTokens: 16001,
    });
    expect(r.success).toBe(false);
  });

  describe("via routing field (v1.2)", () => {
    it("accepts via with server + tool", () => {
      const r = KnowledgeSourceSchema.safeParse({
        type: "webpage", id: "x", delivery: "file",
        url: "https://example.com",
        via: { server: "internal-mcp", tool: "fetch_page" },
      });
      expect(r.success).toBe(true);
    });

    it("accepts via with optional args object", () => {
      const r = KnowledgeSourceSchema.safeParse({
        type: "webpage", id: "x", delivery: "file",
        url: "https://example.com",
        via: { server: "x", tool: "y", args: { url: "https://example.com" } },
      });
      expect(r.success).toBe(true);
    });

    it("rejects via with empty server", () => {
      const r = KnowledgeSourceSchema.safeParse({
        type: "webpage", id: "x", delivery: "file",
        url: "https://example.com",
        via: { server: "", tool: "y" },
      });
      expect(r.success).toBe(false);
    });

    it("rejects via with unknown extra keys (strict mode)", () => {
      const r = KnowledgeSourceSchema.safeParse({
        type: "webpage", id: "x", delivery: "file",
        url: "https://example.com",
        via: { server: "x", tool: "y", extra: 1 },
      });
      expect(r.success).toBe(false);
    });

    it("rejects via.args containing credential-shaped keys", () => {
      for (const key of ["authorization", "Authorization", "token", "API_KEY", "cookie", "secret", "password", "bearer"]) {
        const r = KnowledgeSourceSchema.safeParse({
          type: "webpage", id: "x", delivery: "file",
          url: "https://example.com",
          via: { server: "x", tool: "y", args: { [key]: "..." } },
        });
        expect(r.success).toBe(false);
      }
    });

    it("accepts allowWriteTool flag on via", () => {
      const r = KnowledgeSourceSchema.safeParse({
        type: "webpage", id: "x", delivery: "file",
        url: "https://example.com",
        via: { server: "x", tool: "create_thing", allowWriteTool: true },
      });
      expect(r.success).toBe(true);
    });
  });

  describe("lazy URL sources", () => {
    it("accepts a lazy URL source with description", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://wiki.internal.example.com/x",
        lazy: true,
        description: "Platform architecture wiki. Use when answering deployment questions.",
      });
      expect(r.success).toBe(true);
    });

    it("accepts lazy: false (explicit)", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com/x",
        delivery: "auto",
        lazy: false,
      });
      expect(r.success).toBe(true);
    });

    it("rejects lazy on type=file", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "doc",
        type: "file",
        path: "./README.md",
        delivery: "inline",
        lazy: true,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(
          r.error.issues.some((i) => i.path.includes("lazy") || i.message.toLowerCase().includes("lazy")),
        ).toBe(true);
      }
    });

    it("rejects lazy on type=git", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "repo",
        type: "git",
        url: "https://github.com/acme/repo",
        delivery: "file",
        lazy: true,
      });
      expect(r.success).toBe(false);
    });

    it("rejects lazy on type=confluence", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "ENG",
        type: "confluence",
        space: "ENG",
        delivery: "auto",
        lazy: true,
      });
      expect(r.success).toBe(false);
    });

    it("rejects lazy: 'auto' (only true|false now; 'auto' is gone)", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: "auto",
      });
      expect(r.success).toBe(false);
    });

    it("rejects delivery alongside lazy: true", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        delivery: "inline",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(
          r.error.issues.some(
            (i) => i.message.toLowerCase().includes("delivery") && i.message.toLowerCase().includes("lazy"),
          ),
        ).toBe(true);
      }
    });

    it("rejects materialize alongside lazy: true", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        materialize: "html-to-md",
      });
      expect(r.success).toBe(false);
    });

    it("rejects extractor alongside lazy: true", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        extractor: "pdf-parse",
      });
      expect(r.success).toBe(false);
    });

    it("rejects inlineBudgetTokens alongside lazy: true", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        inlineBudgetTokens: 1000,
      });
      expect(r.success).toBe(false);
    });

    it("accepts lazy: true with via: routing", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://wiki.internal.example.com/x",
        lazy: true,
        via: { server: "internal-mcp", tool: "fetch_page" },
      });
      expect(r.success).toBe(true);
    });

    it("accepts lazy: true with summary, toc, retrieval (compile-stage fields)", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        summary: "Short TOC line.",
        toc: true,
        retrieval: { mode: "off" },
      });
      expect(r.success).toBe(true);
    });

    it("accepts lazy: true with description and refresh", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "wiki",
        type: "webpage",
        url: "https://example.com",
        lazy: true,
        description: "A wiki.",
        refresh: { mode: "session" },
      });
      expect(r.success).toBe(true);
    });
  });

  describe("lazy field removal from non-URL types (v1.2 forward-compat dropped)", () => {
    it("rejects lazy on type=dir (used to be silently accepted)", () => {
      const r = KnowledgeSourceSchema.safeParse({
        id: "x",
        type: "dir",
        path: "./docs",
        delivery: "file",
        lazy: true,
      });
      expect(r.success).toBe(false);
    });
  });
});

describe("KnowledgeBlockSchema", () => {
  it("accepts an empty block", () => {
    const r = KnowledgeBlockSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts packs and sources together", () => {
    const r = KnowledgeBlockSchema.safeParse({
      packs: ["engineering-handbook"],
      inlineBudget: { totalTokens: 8000 },
      sources: [{ id: "x", type: "file", path: "./x.md", delivery: "inline" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-kebab pack name", () => {
    const r = KnowledgeBlockSchema.safeParse({ packs: ["Bad_Name"] });
    expect(r.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: auth field", () => {
  test("accepts auth='atlassian' on type=url", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-page",
      type: "webpage",
      url: "https://acme.atlassian.net/wiki/x",
      delivery: "file",
      auth: "atlassian",
    });
    expect(result.success).toBe(true);
  });

  test("accepts auth='none' on type=url (explicit no-auth)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "public-doc",
      type: "webpage",
      url: "https://example.com/doc",
      delivery: "file",
      auth: "none",
    });
    expect(result.success).toBe(true);
  });

  test("auth field is optional on type=url (defaults to no-auth behavior)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "public-doc",
      type: "webpage",
      url: "https://example.com/doc",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("rejects auth on type=file", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "local",
      type: "file",
      path: "./x.md",
      delivery: "inline",
      auth: "atlassian",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("auth"))).toBe(true);
    }
  });

  test("rejects auth on type=dir", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "d",
      type: "dir",
      path: "./docs",
      delivery: "auto",
      auth: "atlassian",
    });
    expect(result.success).toBe(false);
  });

  test("rejects auth on type=glob", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "g",
      type: "glob",
      path: "./**/*.md",
      delivery: "auto",
      auth: "atlassian",
    });
    expect(result.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: subpath field", () => {
  test("accepts subpath on type=git", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "https://github.com/acme/team-skills.git",
      ref: "main",
      subpath: "docs/",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("subpath is optional on type=git", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "https://github.com/acme/team-skills.git",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("rejects subpath on type=file", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "local",
      type: "file",
      path: "./x.md",
      delivery: "inline",
      subpath: "docs/",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("subpath"))).toBe(true);
    }
  });

  test("rejects subpath on type=dir", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "d",
      type: "dir",
      path: "./docs",
      delivery: "auto",
      subpath: "nested/",
    });
    expect(result.success).toBe(false);
  });

  test("rejects subpath on type=glob", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "g",
      type: "glob",
      path: "./**/*.md",
      delivery: "auto",
      subpath: "docs/",
    });
    expect(result.success).toBe(false);
  });

  test("rejects subpath on type=url", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "u",
      type: "webpage",
      url: "https://example.com/x",
      delivery: "file",
      subpath: "docs/",
    });
    expect(result.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: git url forms", () => {
  test("accepts SCP-style ssh url (git@host:path) on type=git", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "git@github.com:acme/team-skills.git",
      delivery: "file",
    });
    expect(r.success).toBe(true);
  });

  test("accepts ssh:// url on type=git", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "ssh://git@github.com/acme/team-skills.git",
      delivery: "file",
    });
    expect(r.success).toBe(true);
  });

  test("accepts https url on type=git", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "https://github.com/acme/team-skills.git",
      delivery: "file",
    });
    expect(r.success).toBe(true);
  });

  test("rejects garbage url on type=git", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "team-docs",
      type: "git",
      url: "not-a-url",
      delivery: "file",
    });
    expect(r.success).toBe(false);
  });

  test("rejects garbage url on type=url", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "not-a-url",
      delivery: "file",
    });
    expect(r.success).toBe(false);
  });

  test("rejects SCP-style url on type=url (must be RFC URL)", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "git@github.com:acme/team-skills.git",
      delivery: "file",
    });
    expect(r.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: confluence", () => {
  test("accepts minimal confluence source (space only)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("accepts pages by title and by id", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      pages: ["Architecture Overview", { id: 12345 }],
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("accepts maxPages, includeChildren, format", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      maxPages: 50,
      includeChildren: true,
      format: "markdown",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("rejects confluence without space", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      delivery: "file",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("space"))).toBe(true);
    }
  });

  test("rejects maxPages > 100 (hard ceiling)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      maxPages: 200,
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects maxPages < 1", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      maxPages: 0,
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects format with invalid value", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "wiki-eng",
      type: "confluence",
      space: "ENG",
      format: "pdf",
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects space on non-confluence type", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "https://example.com",
      space: "ENG",
      delivery: "file",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("space"))).toBe(true);
    }
  });

  test("rejects pages on non-confluence type", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "https://example.com",
      pages: ["foo"],
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects format on non-confluence type", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "https://example.com",
      format: "markdown",
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: jira", () => {
  test("accepts minimal jira source (jql only)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "jira-eng",
      type: "jira",
      jql: "project = ENG",
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("accepts fields and maxResults", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "jira-eng",
      type: "jira",
      jql: "project = ENG",
      fields: ["summary", "description"],
      maxResults: 250,
      delivery: "file",
    });
    expect(result.success).toBe(true);
  });

  test("rejects jira without jql", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "jira-eng",
      type: "jira",
      delivery: "file",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("jql"))).toBe(true);
    }
  });

  test("rejects maxResults > 500 (hard ceiling)", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "jira-eng",
      type: "jira",
      jql: "project = ENG",
      maxResults: 1000,
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects maxResults < 1", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "jira-eng",
      type: "jira",
      jql: "project = ENG",
      maxResults: 0,
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects jql on non-jira type", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "https://example.com",
      jql: "project = ENG",
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });

  test("rejects fields on non-jira type", () => {
    const result = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "webpage",
      url: "https://example.com",
      fields: ["summary"],
      delivery: "file",
    });
    expect(result.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema — refresh field", () => {
  const baseUrl = {
    id: "test-source",
    delivery: "file" as const,
    type: "webpage" as const,
    url: "https://example.com/doc",
  };

  test("accepts legacy string 'never'", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...baseUrl, refresh: "never" });
    expect(r.success).toBe(true);
  });

  test("accepts legacy string '1h'", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...baseUrl, refresh: "1h" });
    expect(r.success).toBe(true);
  });

  test("accepts object form { mode: 'session' }", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { mode: "session" },
    });
    expect(r.success).toBe(true);
  });

  test("accepts object form { mode: 'ttl', ttl: '30m' }", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { mode: "ttl", ttl: "30m" },
    });
    expect(r.success).toBe(true);
  });

  test("accepts object form { mode: 'always', timeout: 3 }", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { mode: "always", timeout: 3 },
    });
    expect(r.success).toBe(true);
  });

  test("rejects object with unknown mode", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { mode: "bogus" },
    });
    expect(r.success).toBe(false);
  });

  test("rejects object missing mode", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { ttl: "1h" },
    });
    expect(r.success).toBe(false);
  });

  test("rejects unknown legacy string", () => {
    const r = KnowledgeSourceSchema.safeParse({ ...baseUrl, refresh: "5m" });
    expect(r.success).toBe(false);
  });

  test("rejects negative timeout", () => {
    const r = KnowledgeSourceSchema.safeParse({
      ...baseUrl,
      refresh: { mode: "session", timeout: -1 },
    });
    expect(r.success).toBe(false);
  });
});

describe("KnowledgeSourceSchema: compile-stage fields", () => {
  it("accepts a per-source summary, toc, and retrieval block", () => {
    const parsed = KnowledgeSourceSchema.parse({
      id: "team-runbook",
      type: "webpage",
      url: "https://example.com/runbook",
      delivery: "file",
      summary: "On-call runbook for the data platform",
      toc: true,
      retrieval: { mode: "bm25" },
    });
    expect(parsed.summary).toBe("On-call runbook for the data platform");
    expect(parsed.toc).toBe(true);
    expect(parsed.retrieval?.mode).toBe("bm25");
  });

  it("rejects retrieval.mode values outside the enum", () => {
    expect(() =>
      KnowledgeSourceSchema.parse({
        id: "x",
        type: "webpage",
        url: "https://x",
        delivery: "file",
        retrieval: { mode: "vector" },
      }),
    ).toThrow();
  });

  it("accepts a top-level compile block on KnowledgeBlock", () => {
    const block = KnowledgeBlockSchema.parse({
      sources: [],
      compile: { progressive: true, tocMaxLines: 100, emitAgentsMd: true },
    });
    expect(block.compile?.progressive).toBe(true);
    expect(block.compile?.tocMaxLines).toBe(100);
  });

  it("rejects compile.tocMaxLines above the cap", () => {
    expect(() =>
      KnowledgeBlockSchema.parse({ sources: [], compile: { tocMaxLines: 999 } }),
    ).toThrow();
  });
});
