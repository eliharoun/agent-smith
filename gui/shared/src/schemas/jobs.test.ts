import { describe, expect, it } from "bun:test";
import { JobRequest } from "./jobs";

describe("JobRequest", () => {
  it("accepts agent install with required fields", () => {
    const parsed = JobRequest.parse({
      command: "agent.install",
      name: "incident-debugger",
      platforms: ["opencode"],
      withSkills: true,
      refreshConsent: { opencode: "yes" },
    });
    expect(parsed.command).toBe("agent.install");
  });

  it("rejects agent.install-all with refreshConsent (no longer in schema)", () => {
    expect(() =>
      JobRequest.parse({
        command: "agent.install-all",
        platforms: ["opencode"],
        withSkills: false,
        refreshConsent: { opencode: "yes" },
      }),
    ).toThrow();
  });

  it("rejects agent install missing platforms", () => {
    expect(() =>
      JobRequest.parse({ command: "agent.install", name: "x", platforms: [] }),
    ).toThrow();
  });

  it("rejects agent destroy without typed-token confirmation", () => {
    expect(() => JobRequest.parse({ command: "agent.destroy", name: "x" })).toThrow();
  });

  it("accepts agent destroy with matching typed token", () => {
    const parsed = JobRequest.parse({
      command: "agent.destroy",
      name: "incident-debugger",
      confirmName: "incident-debugger",
    });
    expect(parsed.command).toBe("agent.destroy");
  });
});

describe("AgentReconfigure", () => {
  it("accepts grant + revoke arrays", () => {
    const r = JobRequest.parse({
      command: "agent.reconfigure",
      name: "alpha",
      grant: ["opencode"],
      revoke: ["codex"],
    });
    expect(r.command).toBe("agent.reconfigure");
    if (r.command === "agent.reconfigure") {
      expect(r.grant).toEqual(["opencode"]);
      expect(r.revoke).toEqual(["codex"]);
    }
  });

  it("defaults grant + revoke to empty arrays", () => {
    const r = JobRequest.parse({ command: "agent.reconfigure", name: "alpha" });
    if (r.command === "agent.reconfigure") {
      expect(r.grant).toEqual([]);
      expect(r.revoke).toEqual([]);
    }
  });
});

describe("AgentInit", () => {
  it("requires description", () => {
    expect(() => JobRequest.parse({ command: "agent.init", name: "foo" })).toThrow();
  });

  it("rejects description shorter than 10 chars", () => {
    expect(() =>
      JobRequest.parse({
        command: "agent.init",
        name: "foo",
        description: "too short",
      }),
    ).toThrow(/at least 10/);
  });

  it("rejects description longer than 200 chars", () => {
    expect(() =>
      JobRequest.parse({
        command: "agent.init",
        name: "foo",
        description: "x".repeat(201),
      }),
    ).toThrow(/at most 200/);
  });

  it("accepts description at lower bound (10 chars)", () => {
    const r = JobRequest.parse({
      command: "agent.init",
      name: "foo",
      description: "x".repeat(10),
    });
    expect(r.command).toBe("agent.init");
  });

  it("accepts description at upper bound (200 chars)", () => {
    const r = JobRequest.parse({
      command: "agent.init",
      name: "foo",
      description: "x".repeat(200),
    });
    expect(r.command).toBe("agent.init");
  });
});

// ─── Phase 2 ─────────────────────────────────────────────────────────────────

describe("Phase 2 — skill commands", () => {
  it("accepts skill.register with minimum fields", () => {
    const r = JobRequest.parse({
      command: "skill.register",
      path: "/abs/path/to/catalog",
      kind: "user-global",
    });
    expect(r.command).toBe("skill.register");
    if (r.command === "skill.register") {
      expect(r.allowEmpty).toBe(false);
      expect(r.skipGitCheck).toBe(false);
    }
  });

  it("rejects skill.register with unknown kind", () => {
    expect(() =>
      JobRequest.parse({ command: "skill.register", path: "/p", kind: "bogus" }),
    ).toThrow();
  });

  it("rejects skill.register with non-URL gitRemote", () => {
    expect(() =>
      JobRequest.parse({
        command: "skill.register",
        path: "/p",
        kind: "user-global",
        gitRemote: "not a url",
      }),
    ).toThrow();
  });

  it("accepts skill.unregister with pathOrLabel", () => {
    const r = JobRequest.parse({ command: "skill.unregister", pathOrLabel: "my-catalog" });
    expect(r.command).toBe("skill.unregister");
  });

  it("accepts skill.list (no fields required, all defaults false)", () => {
    const r = JobRequest.parse({ command: "skill.list" });
    if (r.command === "skill.list") expect(r.all).toBe(false);
  });

  it("accepts skill.catalogs with no fields", () => {
    const r = JobRequest.parse({ command: "skill.catalogs" });
    expect(r.command).toBe("skill.catalogs");
  });

  it("accepts skill.catalog-rename with distinct labels", () => {
    const r = JobRequest.parse({
      command: "skill.catalog-rename",
      oldLabel: "a",
      newLabel: "b",
    });
    expect(r.command).toBe("skill.catalog-rename");
  });

  it("rejects skill.catalog-rename when old and new labels match", () => {
    expect(() =>
      JobRequest.parse({ command: "skill.catalog-rename", oldLabel: "x", newLabel: "x" }),
    ).toThrow(/newLabel must differ/);
  });

  it("accepts skill.bootstrap with dryRun + targets defaulted", () => {
    const r = JobRequest.parse({ command: "skill.bootstrap" });
    if (r.command === "skill.bootstrap") {
      expect(r.dryRun).toBe(false);
      expect(r.targets).toEqual([]);
    }
  });

  it("accepts skill.install with `name` only", () => {
    const r = JobRequest.parse({ command: "skill.install", name: "the-architect" });
    expect(r.command).toBe("skill.install");
  });

  it("accepts skill.install with `from` only", () => {
    const r = JobRequest.parse({
      command: "skill.install",
      from: "/abs/path/to/skill",
    });
    expect(r.command).toBe("skill.install");
  });

  it("rejects skill.install with both name and from", () => {
    expect(() => JobRequest.parse({ command: "skill.install", name: "x", from: "/p" })).toThrow(
      /exactly one of/,
    );
  });

  it("rejects skill.install with neither name nor from", () => {
    expect(() => JobRequest.parse({ command: "skill.install" })).toThrow(/exactly one of/);
  });

  it("accepts skill.update with `name`", () => {
    const r = JobRequest.parse({ command: "skill.update", name: "the-architect" });
    expect(r.command).toBe("skill.update");
  });

  it("accepts skill.update with all=true", () => {
    const r = JobRequest.parse({ command: "skill.update", all: true });
    expect(r.command).toBe("skill.update");
  });

  it("rejects skill.update with both name and all=true", () => {
    expect(() => JobRequest.parse({ command: "skill.update", name: "x", all: true })).toThrow();
  });

  it("rejects skill.update with neither name nor all=true (default all=false)", () => {
    expect(() => JobRequest.parse({ command: "skill.update" })).toThrow();
  });

  it("accepts skill.uninstall with name", () => {
    const r = JobRequest.parse({ command: "skill.uninstall", name: "the-architect" });
    expect(r.command).toBe("skill.uninstall");
  });
});

describe("Phase 2 — agent catalog commands", () => {
  it("accepts agent.register with minimum fields", () => {
    const r = JobRequest.parse({
      command: "agent.register",
      path: "/abs/path",
      kind: "user-global",
    });
    if (r.command === "agent.register") expect(r.skipGitCheck).toBe(false);
  });

  it("rejects agent.register with unknown kind", () => {
    expect(() =>
      JobRequest.parse({ command: "agent.register", path: "/p", kind: "team-shared" }),
    ).toThrow();
  });

  it("accepts agent.unregister with pathOrLabel", () => {
    const r = JobRequest.parse({ command: "agent.unregister", pathOrLabel: "default" });
    expect(r.command).toBe("agent.unregister");
  });

  it("accepts agent.catalogs", () => {
    const r = JobRequest.parse({ command: "agent.catalogs" });
    expect(r.command).toBe("agent.catalogs");
  });

  it("accepts agent.catalog-rename with distinct labels", () => {
    const r = JobRequest.parse({
      command: "agent.catalog-rename",
      oldLabel: "a",
      newLabel: "b",
    });
    expect(r.command).toBe("agent.catalog-rename");
  });

  it("rejects agent.catalog-rename when old and new labels match", () => {
    expect(() =>
      JobRequest.parse({ command: "agent.catalog-rename", oldLabel: "x", newLabel: "x" }),
    ).toThrow(/newLabel must differ/);
  });
});

describe("Phase 2 — knowledge commands", () => {
  it("accepts knowledge.add with type+pathOrUrl", () => {
    const r = JobRequest.parse({
      command: "knowledge.add",
      agent: "example-agent",
      typeOrUrl: "file",
      pathOrUrl: "./schema.sql",
    });
    if (r.command === "knowledge.add") {
      expect(r.optional).toBe(false);
      expect(r.install).toBe(true);
    }
  });

  it("accepts knowledge.add with URL shortcut (no pathOrUrl)", () => {
    const r = JobRequest.parse({
      command: "knowledge.add",
      agent: "example-agent",
      typeOrUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/123/Onboarding",
    });
    expect(r.command).toBe("knowledge.add");
  });

  it("accepts knowledge.remove with agent + source-id", () => {
    const r = JobRequest.parse({
      command: "knowledge.remove",
      agent: "example-agent",
      sourceId: "schema",
    });
    expect(r.command).toBe("knowledge.remove");
  });

  it("rejects knowledge.remove without sourceId", () => {
    expect(() =>
      JobRequest.parse({ command: "knowledge.remove", agent: "example-agent" }),
    ).toThrow();
  });

  it("accepts knowledge.list with default json=true", () => {
    const r = JobRequest.parse({ command: "knowledge.list", agent: "example-agent" });
    if (r.command === "knowledge.list") expect(r.json).toBe(true);
  });

  it("accepts knowledge.fetch with optional source filter", () => {
    const r = JobRequest.parse({
      command: "knowledge.fetch",
      agent: "example-agent",
      source: "schema",
    });
    expect(r.command).toBe("knowledge.fetch");
  });

  it("accepts knowledge.fetch without source filter", () => {
    const r = JobRequest.parse({ command: "knowledge.fetch", agent: "example-agent" });
    expect(r.command).toBe("knowledge.fetch");
  });

  it("accepts knowledge.validate with no agent filter (all agents)", () => {
    const r = JobRequest.parse({ command: "knowledge.validate" });
    expect(r.command).toBe("knowledge.validate");
  });

  it("accepts knowledge.validate with agent filter", () => {
    const r = JobRequest.parse({ command: "knowledge.validate", agent: "example-agent" });
    expect(r.command).toBe("knowledge.validate");
  });
});

describe("Phase 3 job variants", () => {
  it("accepts daemon.start with no envOverrides", () => {
    expect(JobRequest.safeParse({ command: "daemon.start" }).success).toBe(true);
  });
  it("accepts daemon.start with envOverrides", () => {
    expect(
      JobRequest.safeParse({
        command: "daemon.start",
        envOverrides: { SMITH_PULL_INTERVAL_MS: "60000" },
      }).success,
    ).toBe(true);
  });
  it("accepts daemon.stop", () => {
    expect(JobRequest.safeParse({ command: "daemon.stop" }).success).toBe(true);
  });
  it("update accepts dryRun default", () => {
    const r = JobRequest.parse({ command: "update" });
    expect(r).toMatchObject({ command: "update", dryRun: false });
  });
  it("jack-out requires literal 'jack-out'", () => {
    expect(JobRequest.safeParse({ command: "jack-out", confirmPhrase: "jack-out" }).success).toBe(
      true,
    );
    expect(JobRequest.safeParse({ command: "jack-out", confirmPhrase: "jack out" }).success).toBe(
      false,
    );
    expect(JobRequest.safeParse({ command: "jack-out", confirmPhrase: "JACK-OUT" }).success).toBe(
      false,
    );
  });
  it("knowledge.migrate-codex accepts optional path", () => {
    expect(JobRequest.safeParse({ command: "knowledge.migrate-codex" }).success).toBe(true);
    expect(
      JobRequest.safeParse({ command: "knowledge.migrate-codex", path: "/tmp/h.json" }).success,
    ).toBe(true);
  });
  it("skill.validate requires non-empty name", () => {
    expect(JobRequest.safeParse({ command: "skill.validate", name: "x" }).success).toBe(true);
    expect(JobRequest.safeParse({ command: "skill.validate", name: "" }).success).toBe(false);
  });
  it("doctor accepts fixKnowledgeRefresh", () => {
    const r = JobRequest.parse({ command: "doctor", fixKnowledgeRefresh: true });
    expect(r).toMatchObject({ command: "doctor", fixKnowledgeRefresh: true });
  });
  it("doctor defaults fixKnowledgeRefresh false", () => {
    const r = JobRequest.parse({ command: "doctor" });
    expect(r).toMatchObject({ fixKnowledgeRefresh: false });
  });
});

describe("AgentInstall with --from (C4.2.1)", () => {
  it("accepts from + ref alongside name + platforms", () => {
    const r = JobRequest.parse({
      command: "agent.install",
      name: "alpha",
      platforms: ["claude-code"],
      from: "https://x/y/z.git",
      ref: "main",
    });
    if (r.command !== "agent.install") throw new Error();
    expect(r.from).toBe("https://x/y/z.git");
    expect(r.ref).toBe("main");
  });

  it("accepts from alone (no ref → CLI uses HEAD)", () => {
    const r = JobRequest.parse({
      command: "agent.install",
      from: "https://x/y/z.git",
    });
    if (r.command !== "agent.install") throw new Error();
    expect(r.ref).toBeUndefined();
    expect(r.from).toBe("https://x/y/z.git");
  });

  it("rejects ref starting with -", () => {
    expect(() =>
      JobRequest.parse({
        command: "agent.install",
        from: "https://x/y/z.git",
        ref: "--upload-pack=evil",
      }),
    ).toThrow();
  });

  it("rejects ref with shell metacharacters", () => {
    expect(() =>
      JobRequest.parse({
        command: "agent.install",
        from: "https://x/y/z.git",
        ref: "main;rm -rf /",
      }),
    ).toThrow();
  });

  it("still accepts local install (no from, with name + platforms)", () => {
    const r = JobRequest.parse({
      command: "agent.install",
      name: "alpha",
      platforms: ["claude-code"],
    });
    if (r.command !== "agent.install") throw new Error();
    expect(r.from).toBeUndefined();
  });

  it("rejects install with neither from nor name+platforms", () => {
    expect(() => JobRequest.parse({ command: "agent.install" })).toThrow();
  });

  it("rejects install with name but no platforms when from is unset", () => {
    expect(() =>
      JobRequest.parse({ command: "agent.install", name: "alpha", platforms: [] }),
    ).toThrow();
  });
});

describe("SkillInstall with ref (C4.2.2)", () => {
  it("accepts from + ref", () => {
    const r = JobRequest.parse({
      command: "skill.install",
      from: "https://x/y/z.git",
      ref: "v1",
    });
    if (r.command !== "skill.install") throw new Error();
    expect(r.ref).toBe("v1");
  });

  it("rejects ref with leading -", () => {
    expect(() =>
      JobRequest.parse({
        command: "skill.install",
        from: "https://x/y/z.git",
        ref: "-x",
      }),
    ).toThrow();
  });

  it("rejects ref with shell metacharacters", () => {
    expect(() =>
      JobRequest.parse({
        command: "skill.install",
        from: "https://x/y/z.git",
        ref: "main;rm",
      }),
    ).toThrow();
  });

  it("still accepts name-only install (no from, no ref)", () => {
    const r = JobRequest.parse({ command: "skill.install", name: "architect" });
    if (r.command !== "skill.install") throw new Error();
    expect(r.ref).toBeUndefined();
  });
});

describe("AgentSync (C4.2.3)", () => {
  it("accepts a name", () => {
    const r = JobRequest.parse({ command: "agent.sync", name: "alpha" });
    if (r.command !== "agent.sync") throw new Error();
    expect(r.name).toBe("alpha");
  });
  it("rejects empty name", () => {
    expect(() => JobRequest.parse({ command: "agent.sync", name: "" })).toThrow();
  });
  it("rejects missing name", () => {
    expect(() => JobRequest.parse({ command: "agent.sync" })).toThrow();
  });
});

describe("SkillSync (C4.2.3)", () => {
  it("accepts a name", () => {
    const r = JobRequest.parse({ command: "skill.sync", name: "architect" });
    if (r.command !== "skill.sync") throw new Error();
    expect(r.name).toBe("architect");
  });
  it("rejects empty name", () => {
    expect(() => JobRequest.parse({ command: "skill.sync", name: "" })).toThrow();
  });
});
