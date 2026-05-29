import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";
import { SmithError } from "../../src/core/smith-error";

describe("knowledgeAdd", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-ka-"));
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify({
        name: "x",
        description: "Use to test things.",
        targets: ["opencode"],
        modelTier: "balanced",
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("adds a file source to the config", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "file",
      pathOrUrl: "./schema.sql",
      delivery: "inline",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources).toHaveLength(1);
    expect(cfg.knowledge.sources[0].type).toBe("file");
    expect(cfg.knowledge.sources[0].path).toBe("./schema.sql");
    expect(cfg.knowledge.sources[0].id).toMatch(/^schema/);
  });

  it("adds a url source with auto-derived id", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "url",
      pathOrUrl: "https://stripe.com/docs/api",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].url).toBe("https://stripe.com/docs/api");
    expect(cfg.knowledge.sources[0].id).toBe("stripe-com-docs-api");
  });

  it("respects an explicit --id and --description", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "url",
      pathOrUrl: "https://example.com/x",
      id: "my-id",
      description: "An example",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("my-id");
    expect(cfg.knowledge.sources[0].description).toBe("An example");
  });

  it("rejects an id collision in the same config", async () => {
    await knowledgeAdd({ bundleDir: dir, type: "file", pathOrUrl: "./a.md", id: "shared" });
    const err = await knowledgeAdd({
      bundleDir: dir,
      type: "file",
      pathOrUrl: "./b.md",
      id: "shared",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("knowledge block (after add)");
    expect(err.payload.reasons.join(" ")).toMatch(/shared/);
  });

  it("--optional adds optional:true to the new source (CORE-8)", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "url",
      pathOrUrl: "https://flaky.example.com/api",
      optional: true,
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].optional).toBe(true);
  });

  it("omits optional field when --optional not set (default)", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "file",
      pathOrUrl: "./schema.sql",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].optional).toBeUndefined();
  });

  describe("atlassian auth probe (confluence/jira only)", () => {
    it("emits warn line when resolveAuth returns null", async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      try {
        const code = await knowledgeAdd({
          bundleDir: dir,
          type: "confluence",
          pathOrUrl: "ENG",
          resolveAuth: () => null,
        });
        expect(code).toBe(0);
      } finally {
        console.log = origLog;
      }
      expect(
        logs.some(
          (l) =>
            l.includes("Atlassian auth not configured") &&
            l.includes("SMITH_ATLASSIAN_EMAIL") &&
            l.includes("SMITH_ATLASSIAN_API_TOKEN"),
        ),
      ).toBe(true);
    });

    it("emits NO warn line when resolveAuth returns a valid auth", async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      try {
        const code = await knowledgeAdd({
          bundleDir: dir,
          type: "jira",
          pathOrUrl: "project=ENG",
          resolveAuth: () => ({
            email: "u@example.com",
            token: "t",
            source: "env-smith",
          }),
        });
        expect(code).toBe(0);
      } finally {
        console.log = origLog;
      }
      expect(logs.some((l) => l.includes("Atlassian auth not configured"))).toBe(false);
    });

    it("does NOT probe for non-atlassian types", async () => {
      let called = false;
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "file",
        pathOrUrl: "./x.md",
        resolveAuth: () => {
          called = true;
          return null;
        },
      });
      expect(code).toBe(0);
      expect(called).toBe(false);
    });

    it("falls back to real resolveAtlassianAuth when DI not provided", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "ENG",
      });
      expect(code).toBe(0);
    });
  });

  describe("confluence source", () => {
    it("adds a confluence source with space only", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "ENG",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
      expect(cfg.knowledge.sources).toHaveLength(1);
      const s = cfg.knowledge.sources[0];
      expect(s.type).toBe("confluence");
      expect(s.space).toBe("ENG");
      expect(s.id).toBe("eng");
      expect(s.pages).toBeUndefined();
      expect(s.maxPages).toBeUndefined();
      expect(s.includeChildren).toBeUndefined();
      expect(s.format).toBeUndefined();
    });

    it("adds a confluence source with all flags", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "ENG",
        pages: "Onboarding,Runbook,id:123",
        maxPages: 50,
        includeChildren: true,
        format: "markdown",
        description: "Engineering wiki",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
      const s = cfg.knowledge.sources[0];
      expect(s.pages).toEqual(["Onboarding", "Runbook", { id: 123 }]);
      expect(s.maxPages).toBe(50);
      expect(s.includeChildren).toBe(true);
      expect(s.format).toBe("markdown");
      expect(s.description).toBe("Engineering wiki");
    });

    it("rejects --max-pages above the schema ceiling (100)", async () => {
      const err = await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "ENG",
        maxPages: 200,
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(SmithError);
      expect(err.payload.code).toBe("validation-failed");
      expect(err.payload.reasons.join(" ")).toMatch(/maxPages/i);
    });

    it("rejects an invalid --format value", async () => {
      const err = await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "ENG",
        // @ts-expect-error — exercising the runtime guard for bad values
        format: "wikitext",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(SmithError);
      expect(err.payload.code).toBe("validation-failed");
    });
  });

  describe("jira source", () => {
    it("adds a jira source with jql only", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "jira",
        pathOrUrl: "project=ENG AND status='To Do'",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
      expect(cfg.knowledge.sources).toHaveLength(1);
      const s = cfg.knowledge.sources[0];
      expect(s.type).toBe("jira");
      expect(s.jql).toBe("project=ENG AND status='To Do'");
      expect(s.id).toBe("project-eng-and-status-to-do");
      expect(s.fields).toBeUndefined();
      expect(s.maxResults).toBeUndefined();
    });

    it("adds a jira source with all flags", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "jira",
        pathOrUrl: "project=ENG",
        fields: "summary,description,status,priority",
        maxResults: 250,
        description: "Engineering tickets",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
      const s = cfg.knowledge.sources[0];
      expect(s.fields).toEqual(["summary", "description", "status", "priority"]);
      expect(s.maxResults).toBe(250);
      expect(s.description).toBe("Engineering tickets");
    });

    it("passes --fields '*all' through unchanged", async () => {
      const code = await knowledgeAdd({
        bundleDir: dir,
        type: "jira",
        pathOrUrl: "project=ENG",
        fields: "*all",
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      });
      expect(code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
      expect(cfg.knowledge.sources[0].fields).toEqual(["*all"]);
    });

    it("rejects --max-results above the schema ceiling (500)", async () => {
      const err = await knowledgeAdd({
        bundleDir: dir,
        type: "jira",
        pathOrUrl: "project=ENG",
        maxResults: 1000,
        resolveAuth: () => ({ email: "u", token: "t", source: "env-smith" }),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(SmithError);
      expect(err.payload.code).toBe("validation-failed");
      expect(err.payload.reasons.join(" ")).toMatch(/maxResults/i);
    });
  });
});

describe("knowledgeAdd config-file error classification (CLI-21)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-ka-cls-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("throws SmithError(config-missing) when agent.config.json does not exist", async () => {
    const err = await knowledgeAdd({
      bundleDir: dir,
      type: "file",
      pathOrUrl: "./x.md",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("config-missing");
    expect(err.payload.path).toContain("agent.config.json");
    expect(err.payload.suggestedCommand).toBe(
      `smith agent init ${basename(dir)}`,
    );
  });

  it("throws SmithError(validation-failed) when agent.config.json has invalid JSON", async () => {
    const cfgPath = join(dir, "agent.config.json");
    await writeFile(cfgPath, "{not json");
    const err = await knowledgeAdd({
      bundleDir: dir,
      type: "file",
      pathOrUrl: "./x.md",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(Array.isArray(err.payload.reasons)).toBe(true);
    expect(err.payload.reasons.length).toBeGreaterThan(0);
    expect(err.payload.reasons[0]).toContain("agent.config.json");
    expect(err.payload.reasons[0]).toMatch(/JSON|parse|Unexpected|expected/i);
  });
});

describe("knowledgeAdd auto-materialize (post-add install)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-ka-mat-"));
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify({
        name: "myagent",
        description: "Use to test auto-materialize.",
        targets: ["opencode"],
        modelTier: "balanced",
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("calls runInstall(agentName) by default after writing the source", async () => {
    const calls: string[] = [];
    const code = await knowledgeAdd({
      bundleDir: dir,
      agentName: "myagent",
      type: "url",
      pathOrUrl: "https://example.com/docs",
      runInstall: async (name) => {
        calls.push(name);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["myagent"]);
  });

  it("skips runInstall when installAfter=false (the --no-install path)", async () => {
    let called = false;
    const code = await knowledgeAdd({
      bundleDir: dir,
      agentName: "myagent",
      type: "url",
      pathOrUrl: "https://example.com/docs",
      installAfter: false,
      runInstall: async () => {
        called = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(called).toBe(false);
  });

  it("source is persisted even when runInstall throws — config-first guarantee", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      agentName: "myagent",
      type: "url",
      pathOrUrl: "https://example.com/docs",
      runInstall: async () => {
        throw new Error("network down");
      },
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources).toHaveLength(1);
    expect(cfg.knowledge.sources[0].url).toBe("https://example.com/docs");
  });

  it("does not call runInstall when agentName is missing (programmatic call)", async () => {
    let called = false;
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "url",
      pathOrUrl: "https://example.com/docs",
      runInstall: async () => {
        called = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(called).toBe(false);
  });
});

describe("deriveId for confluence/jira", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-ka-"));
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify({
        name: "x",
        description: "Use to test things.",
        targets: ["opencode"],
        modelTier: "balanced",
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("derives confluence id from space alone", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "ENG",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("eng");
  });

  it("derives confluence id from space + single page", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "ENG",
      pages: "Onboarding Guide",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("eng-onboarding-guide");
  });

  it("derives confluence id from space only when --pages has multiple entries", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "ENG",
      pages: "A,B",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("eng");
  });

  it("derives jira id by slugifying the jql, truncated to 60 chars", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "jira",
      pathOrUrl: "project=ENG AND status='To Do'",
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("project-eng-and-status-to-do");
  });

  it("truncates the jira-derived id to 60 chars", async () => {
    const longJql =
      "project=VERYLONGPROJECTNAME AND component in (one, two, three, four, five, six)";
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "jira",
      pathOrUrl: longJql,
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id.length).toBeLessThanOrEqual(60);
    expect(cfg.knowledge.sources[0].id).not.toMatch(/-$/);
  });
});
