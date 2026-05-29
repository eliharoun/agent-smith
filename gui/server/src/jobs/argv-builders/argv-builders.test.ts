import { describe, expect, it } from "bun:test";
import { buildArgv } from "./index";

describe("argv builders", () => {
  it("init", () => {
    const r = buildArgv({ command: "init" });
    expect(r.argv).toEqual(["init"]);
    expect(r.lockKeys).toEqual(["global:init"]);
    expect(r.preview).toBe("smith init");
  });

  it("init-user", () => {
    const r = buildArgv({ command: "init-user" });
    expect(r.argv).toEqual(["init-user"]);
    expect(r.preview).toBe("smith init-user");
  });

  it("status", () => {
    expect(buildArgv({ command: "status" }).argv).toEqual(["status"]);
  });

  it("doctor without json", () => {
    expect(buildArgv({ command: "doctor" }).argv).toEqual(["doctor"]);
  });

  it("doctor with json", () => {
    expect(buildArgv({ command: "doctor", json: true }).argv).toEqual(["doctor", "--json"]);
  });

  it("agent.list", () => {
    expect(buildArgv({ command: "agent.list" }).argv).toEqual(["agent", "list"]);
  });

  it("agent.init", () => {
    const r = buildArgv({
      command: "agent.init",
      name: "foo",
      description: "Tutor + bundle architect",
    });
    expect(r.argv).toEqual(["agent", "init", "foo", "--description", "Tutor + bundle architect"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  it("agent.init with template", () => {
    const r = buildArgv({
      command: "agent.init",
      name: "foo",
      description: "Tutor + bundle architect",
      template: "incident-debugger",
    });
    expect(r.argv).toEqual([
      "agent",
      "init",
      "foo",
      "--description",
      "Tutor + bundle architect",
      "--template",
      "incident-debugger",
    ]);
  });

  it("agent.validate", () => {
    expect(buildArgv({ command: "agent.validate", name: "foo" }).argv).toEqual([
      "agent",
      "validate",
      "foo",
    ]);
  });

  it("agent.install with one platform, no skills", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
    });
    expect(r.argv).toEqual(["agent", "install", "foo", "--yes", "--platforms", "opencode"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  it("agent.install with multiple platforms, skills, refresh consent", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode", "claude-code"],
      withSkills: true,
      refreshConsent: { opencode: "yes", "claude-code": "no" },
    });
    expect(r.argv).toEqual([
      "agent",
      "install",
      "foo",
      "--yes",
      "--platforms",
      "opencode,claude-code",
      "--with-skills",
      "--refresh-consent",
      "opencode=yes,claude-code=no",
    ]);
  });

  it("agent.install filters out skip consent values", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode", "claude-code"],
      withSkills: false,
      refreshConsent: { opencode: "yes", "claude-code": "skip" },
    });
    expect(r.argv).toEqual([
      "agent",
      "install",
      "foo",
      "--yes",
      "--platforms",
      "opencode,claude-code",
      "--refresh-consent",
      "opencode=yes",
    ]);
  });

  it("agent.install omits --refresh-consent when all entries are skip", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
      refreshConsent: { opencode: "skip" },
    });
    expect(r.argv).toEqual(["agent", "install", "foo", "--yes", "--platforms", "opencode"]);
  });

  it("agent.install-all", () => {
    const r = buildArgv({
      command: "agent.install-all",
      platforms: ["opencode"],
      withSkills: false,
    });
    expect(r.argv).toEqual(["agent", "install-all", "--yes", "--platforms", "opencode"]);
    expect(r.lockKeys).toEqual(["global:agents"]);
  });

  it("agent.uninstall", () => {
    const r = buildArgv({
      command: "agent.uninstall",
      name: "foo",
      platforms: ["codex"],
    });
    expect(r.argv).toEqual(["agent", "uninstall", "foo", "--yes", "--platforms", "codex"]);
  });

  it("agent.uninstall-all", () => {
    const r = buildArgv({
      command: "agent.uninstall-all",
      platforms: ["opencode"],
    });
    expect(r.argv).toEqual(["agent", "uninstall-all", "--yes", "--platforms", "opencode"]);
  });

  // Task 1.5: --force flag plumbing through GUI argv builders.
  it("agent.install with force=true appends --force", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
      force: true,
    });
    expect(r.argv).toContain("--force");
  });

  it("agent.install with force=false omits --force", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
      force: false,
    });
    expect(r.argv).not.toContain("--force");
  });

  it("agent.install-all with force=true appends --force", () => {
    const r = buildArgv({
      command: "agent.install-all",
      platforms: ["opencode"],
      withSkills: false,
      force: true,
    });
    expect(r.argv).toContain("--force");
  });

  it("agent.uninstall with force=true appends --force", () => {
    const r = buildArgv({
      command: "agent.uninstall",
      name: "foo",
      platforms: ["codex"],
      force: true,
    });
    expect(r.argv).toContain("--force");
  });

  it("agent.uninstall-all with force=true appends --force", () => {
    const r = buildArgv({
      command: "agent.uninstall-all",
      platforms: ["opencode"],
      force: true,
    });
    expect(r.argv).toContain("--force");
  });

  it("agent.reconfigure", () => {
    const r = buildArgv({ command: "agent.reconfigure", name: "foo" });
    expect(r.argv).toEqual(["agent", "reconfigure", "foo"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  it("agent.reconfigure with grant + revoke produces flags", () => {
    const r = buildArgv({
      command: "agent.reconfigure",
      name: "foo",
      grant: ["opencode"],
      revoke: ["codex"],
    });
    expect(r.argv).toEqual([
      "agent",
      "reconfigure",
      "foo",
      "--grant",
      "opencode",
      "--revoke",
      "codex",
    ]);
  });

  it("agent.reconfigure with empty grant + revoke produces no flags", () => {
    const r = buildArgv({ command: "agent.reconfigure", name: "foo" });
    expect(r.argv).toEqual(["agent", "reconfigure", "foo"]);
  });

  it("agent.destroy with confirm", () => {
    const r = buildArgv({
      command: "agent.destroy",
      name: "foo",
      confirmName: "foo",
    });
    expect(r.argv).toEqual(["agent", "destroy", "foo", "--yes"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  it("agent.destroy with force appends --force (chained uninstall+destroy)", () => {
    const r = buildArgv({
      command: "agent.destroy",
      name: "foo",
      confirmName: "foo",
      force: true,
    });
    expect(r.argv).toEqual(["agent", "destroy", "foo", "--yes", "--force"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  it("agent.destroy with force=false omits --force", () => {
    const r = buildArgv({
      command: "agent.destroy",
      name: "foo",
      confirmName: "foo",
      force: false,
    });
    expect(r.argv).toEqual(["agent", "destroy", "foo", "--yes"]);
  });

  it("agent.destroy throws when confirmName does not match name", () => {
    expect(() =>
      buildArgv({
        command: "agent.destroy",
        name: "foo",
        confirmName: "bar",
      }),
    ).toThrow(/confirmName mismatch/);
  });

  it("agent.install omits --refresh-consent when refreshConsent is empty {}", () => {
    // Distinct from the existing "all skip" and "undefined" cases: the
    // request explicitly carries an empty object, which should produce no
    // --refresh-consent flag (no entries to forward).
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
      refreshConsent: {},
    });
    expect(r.argv).toEqual(["agent", "install", "foo", "--yes", "--platforms", "opencode"]);
    expect(r.argv).not.toContain("--refresh-consent");
  });

  // ----- skill commands -----

  it("builds skill.register with all flags", () => {
    const r = buildArgv({
      command: "skill.register",
      path: "/abs/path",
      kind: "user-global",
      label: "my-cat",
      gitRemote: "https://example.com/repo.git",
      allowEmpty: true,
      skipGitCheck: false,
    });
    expect(r.argv).toEqual([
      "skill",
      "register",
      "/abs/path",
      "--kind",
      "user-global",
      "--label",
      "my-cat",
      "--git-remote",
      "https://example.com/repo.git",
      "--allow-empty",
    ]);
    expect(r.lockKeys).toEqual(["global:skills"]);
    expect(r.preview).toBe(
      "smith skill register /abs/path --kind user-global --label my-cat --git-remote https://example.com/repo.git --allow-empty",
    );
  });

  it("builds skill.register with skip-git-check", () => {
    const r = buildArgv({
      command: "skill.register",
      path: "/p",
      kind: "team-shared",
      allowEmpty: false,
      skipGitCheck: true,
    });
    expect(r.argv).toEqual([
      "skill",
      "register",
      "/p",
      "--kind",
      "team-shared",
      "--skip-git-check",
    ]);
  });

  it("builds skill.unregister", () => {
    const r = buildArgv({ command: "skill.unregister", pathOrLabel: "my-cat" });
    expect(r.argv).toEqual(["skill", "unregister", "my-cat"]);
    expect(r.lockKeys).toEqual(["global:skills"]);
    expect(r.preview).toBe("smith skill unregister my-cat");
  });

  it("builds skill.list with --all", () => {
    const r = buildArgv({ command: "skill.list", all: true });
    expect(r.argv).toEqual(["skill", "list", "--all"]);
    expect(r.lockKeys).toEqual([]);
  });

  it("builds skill.list without --all", () => {
    const r = buildArgv({ command: "skill.list", all: false });
    expect(r.argv).toEqual(["skill", "list"]);
  });

  it("builds skill.catalogs", () => {
    const r = buildArgv({ command: "skill.catalogs" });
    expect(r.argv).toEqual(["skill", "catalogs"]);
    expect(r.lockKeys).toEqual([]);
    expect(r.preview).toBe("smith skill catalogs");
  });

  it("builds skill.catalog-rename", () => {
    const r = buildArgv({
      command: "skill.catalog-rename",
      oldLabel: "a",
      newLabel: "b",
    });
    expect(r.argv).toEqual(["skill", "catalog", "rename", "a", "b"]);
    expect(r.lockKeys).toEqual(["catalog:a", "catalog:b", "global:skills"]);
  });

  it("builds skill.bootstrap with targets and dry-run", () => {
    const r = buildArgv({
      command: "skill.bootstrap",
      dryRun: true,
      targets: ["opencode", "claude-code"],
    });
    expect(r.argv).toEqual([
      "skill",
      "bootstrap",
      "--dry-run",
      "--targets",
      "opencode,claude-code",
    ]);
    expect(r.lockKeys).toEqual(["global:skills"]);
  });

  it("builds skill.bootstrap without targets", () => {
    const r = buildArgv({ command: "skill.bootstrap", dryRun: false, targets: [] });
    expect(r.argv).toEqual(["skill", "bootstrap"]);
  });

  it("builds skill.install by name", () => {
    const r = buildArgv({
      command: "skill.install",
      name: "example/test",
      targets: ["opencode"],
    });
    expect(r.argv).toEqual(["skill", "install", "example/test", "--targets", "opencode"]);
    expect(r.lockKeys).toEqual(["skill:example/test", "global:skills"]);
  });

  it("builds skill.install by path with --as", () => {
    const r = buildArgv({
      command: "skill.install",
      from: "/abs/path",
      as: "adhoc-cat",
      targets: [],
    });
    expect(r.argv).toEqual(["skill", "install", "--from", "/abs/path", "--as", "adhoc-cat"]);
    expect(r.lockKeys).toEqual(["global:skills"]);
  });

  it("builds skill.update --all", () => {
    const r = buildArgv({ command: "skill.update", all: true });
    expect(r.argv).toEqual(["skill", "update", "--all"]);
    expect(r.lockKeys).toEqual(["global:skills"]);
  });

  it("builds skill.update by name", () => {
    const r = buildArgv({ command: "skill.update", name: "x", all: false });
    expect(r.argv).toEqual(["skill", "update", "x"]);
    expect(r.lockKeys).toEqual(["skill:x", "global:skills"]);
  });

  it("builds skill.uninstall", () => {
    const r = buildArgv({ command: "skill.uninstall", name: "x" });
    expect(r.argv).toEqual(["skill", "uninstall", "x"]);
    expect(r.lockKeys).toEqual(["skill:x", "global:skills"]);
  });

  // ----- agent-catalog commands -----

  it("builds agent.register", () => {
    const r = buildArgv({
      command: "agent.register",
      path: "/abs",
      kind: "registered",
      gitRemote: "https://example.com/x.git",
      allowEmpty: false,
      skipGitCheck: false,
    });
    expect(r.argv).toEqual([
      "agent",
      "register",
      "/abs",
      "--kind",
      "registered",
      "--git-remote",
      "https://example.com/x.git",
    ]);
    expect(r.lockKeys).toEqual(["global:catalogs"]);
  });

  it("builds agent.unregister", () => {
    const r = buildArgv({ command: "agent.unregister", pathOrLabel: "my-cat" });
    expect(r.argv).toEqual(["agent", "unregister", "my-cat"]);
    expect(r.lockKeys).toEqual(["global:catalogs"]);
  });

  it("builds agent.catalogs", () => {
    const r = buildArgv({ command: "agent.catalogs" });
    expect(r.argv).toEqual(["agent", "catalogs"]);
    expect(r.lockKeys).toEqual([]);
  });

  it("builds agent.catalog-rename", () => {
    const r = buildArgv({
      command: "agent.catalog-rename",
      oldLabel: "a",
      newLabel: "b",
    });
    expect(r.argv).toEqual(["agent", "catalog", "rename", "a", "b"]);
    expect(r.lockKeys).toEqual(["catalog:a", "catalog:b", "global:catalogs"]);
  });

  // ----- knowledge commands -----

  it("builds knowledge.add for a confluence url shortcut", () => {
    const r = buildArgv({
      command: "knowledge.add",
      agent: "incident-debugger",
      typeOrUrl: "confluence",
      pathOrUrl: "OPS",
      pages: "id:12345",
      format: "markdown",
      optional: false,
      install: true,
      includeChildren: false,
    });
    expect(r.argv).toEqual([
      "knowledge",
      "add",
      "incident-debugger",
      "confluence",
      "OPS",
      "--pages",
      "id:12345",
      "--format",
      "markdown",
    ]);
    expect(r.lockKeys).toEqual(["knowledge:incident-debugger", "agent:incident-debugger"]);
  });

  it("builds knowledge.add with --no-install", () => {
    const r = buildArgv({
      command: "knowledge.add",
      agent: "x",
      typeOrUrl: "file",
      pathOrUrl: "/abs/notes.md",
      optional: false,
      install: false,
      includeChildren: false,
    });
    expect(r.argv).toContain("--no-install");
  });

  it("builds knowledge.remove", () => {
    const r = buildArgv({
      command: "knowledge.remove",
      agent: "incident-debugger",
      sourceId: "kb-runbook",
    });
    expect(r.argv).toEqual(["knowledge", "remove", "incident-debugger", "kb-runbook"]);
    expect(r.lockKeys).toEqual(["knowledge:incident-debugger"]);
  });

  it("builds knowledge.list with --json", () => {
    const r = buildArgv({ command: "knowledge.list", agent: "x", json: true });
    expect(r.argv).toEqual(["knowledge", "list", "x", "--json"]);
    expect(r.lockKeys).toEqual([]);
  });

  it("builds knowledge.fetch with --source", () => {
    const r = buildArgv({ command: "knowledge.fetch", agent: "x", source: "foo" });
    expect(r.argv).toEqual(["knowledge", "fetch", "x", "--source", "foo"]);
    expect(r.lockKeys).toEqual(["knowledge:x", "agent:x"]);
  });

  it("builds knowledge.validate (all agents)", () => {
    const r = buildArgv({ command: "knowledge.validate" });
    expect(r.argv).toEqual(["knowledge", "validate"]);
  });

  it("builds knowledge.validate (single agent)", () => {
    const r = buildArgv({ command: "knowledge.validate", agent: "x" });
    expect(r.argv).toEqual(["knowledge", "validate", "x"]);
  });

  // ---- Phase 3, Task 12: daemon + skill.validate ----

  it("builds daemon.start (no env overrides)", () => {
    const r = buildArgv({ command: "daemon.start" });
    expect(r.argv).toEqual(["daemon", "start"]);
    expect(r.lockKeys).toEqual(["daemon"]);
    expect(r.preview).toBe("smith daemon start");
    expect(r.envOverrides).toBeUndefined();
  });

  it("builds daemon.start with envOverrides (no argv change)", () => {
    const r = buildArgv({
      command: "daemon.start",
      envOverrides: { SMITH_PULL_INTERVAL_MS: "60000" },
    });
    expect(r.argv).toEqual(["daemon", "start"]);
    expect(r.envOverrides).toEqual({ SMITH_PULL_INTERVAL_MS: "60000" });
  });

  it("builds daemon.stop", () => {
    const r = buildArgv({ command: "daemon.stop" });
    expect(r.argv).toEqual(["daemon", "stop"]);
    expect(r.lockKeys).toEqual(["daemon"]);
    expect(r.preview).toBe("smith daemon stop");
  });

  it("builds skill.validate <name>", () => {
    const r = buildArgv({ command: "skill.validate", name: "foo" });
    expect(r.argv).toEqual(["skill", "validate", "foo"]);
    expect(r.lockKeys).toEqual([]);
    expect(r.preview).toBe("smith skill validate foo");
  });

  // ---- Phase 3, Task 13: update, knowledge.migrate-codex, doctor extension ----

  it("builds update (no flags)", () => {
    const r = buildArgv({ command: "update", dryRun: false });
    expect(r.argv).toEqual(["update"]);
    expect(r.lockKeys).toEqual(["workspace"]);
    expect(r.preview).toBe("smith update");
  });

  it("builds update --dry-run", () => {
    const r = buildArgv({ command: "update", dryRun: true });
    expect(r.argv).toEqual(["update", "--dry-run"]);
    expect(r.preview).toBe("smith update --dry-run");
  });

  it("builds knowledge.migrate-codex (bare)", () => {
    const r = buildArgv({ command: "knowledge.migrate-codex" });
    expect(r.argv).toEqual(["knowledge", "migrate-codex"]);
    expect(r.lockKeys).toEqual(["workspace"]);
    expect(r.preview).toBe("smith knowledge migrate-codex");
  });

  it("builds knowledge.migrate-codex with --path", () => {
    const r = buildArgv({
      command: "knowledge.migrate-codex",
      path: "/tmp/hooks.json",
    });
    expect(r.argv).toEqual(["knowledge", "migrate-codex", "--path", "/tmp/hooks.json"]);
    expect(r.preview).toBe("smith knowledge migrate-codex --path /tmp/hooks.json");
  });

  it("builds doctor --fix-knowledge-refresh", () => {
    const r = buildArgv({ command: "doctor", fixKnowledgeRefresh: true });
    expect(r.argv).toEqual(["doctor", "--fix-knowledge-refresh"]);
  });

  it("builds doctor --json --fix-knowledge-refresh", () => {
    const r = buildArgv({ command: "doctor", json: true, fixKnowledgeRefresh: true });
    expect(r.argv).toEqual(["doctor", "--json", "--fix-knowledge-refresh"]);
  });

  // ---- Phase 3, Task 14: jack-out ----

  it("builds jack-out --yes with all three locks", () => {
    const r = buildArgv({ command: "jack-out", confirmPhrase: "jack-out" });
    expect(r.argv).toEqual(["jack-out", "--yes"]);
    expect(r.lockKeys).toEqual(["workspace", "daemon", "all-agents"]);
    expect(r.preview).toBe("smith jack-out --yes");
  });

  it("throws when jack-out confirmPhrase mismatches at the builder layer", () => {
    // Schema would reject this first, but defense in depth — the builder
    // re-validates so a payload that bypassed middleware still aborts.
    expect(() => buildArgv({ command: "jack-out", confirmPhrase: "nope" as "jack-out" })).toThrow(
      /confirmPhrase/,
    );
  });

  // ─── C4.2.4: agent.install --from / --ref ──────────────────────────────
  it("agent.install with from + ref (no name/platforms — CLI derives both)", () => {
    const r = buildArgv({
      command: "agent.install",
      withSkills: false,
      platforms: [],
      from: "https://x/y/z.git",
      ref: "main",
    });
    expect(r.argv).toContain("--from");
    expect(r.argv).toContain("https://x/y/z.git");
    expect(r.argv).toContain("--ref");
    expect(r.argv).toContain("main");
    // No --platforms when platforms list is empty (CLI prompts via SSE).
    expect(r.argv).not.toContain("--platforms");
    // No bare name positional — the bundle name is derived from --from.
    expect(r.argv.slice(0, 3)).toEqual(["agent", "install", "--yes"]);
  });

  it("agent.install with from but no ref → omits --ref", () => {
    const r = buildArgv({
      command: "agent.install",
      withSkills: false,
      platforms: [],
      from: "https://x/y/z.git",
    });
    expect(r.argv).toContain("--from");
    expect(r.argv).not.toContain("--ref");
  });

  it("agent.install with from + name + platforms passes all three through", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "alpha",
      platforms: ["claude-code"],
      withSkills: false,
      from: "https://x/y/z.git",
      ref: "v1",
    });
    expect(r.argv).toContain("--from");
    expect(r.argv).toContain("--ref");
    expect(r.argv).toContain("--platforms");
    expect(r.argv).toContain("alpha");
  });

  it("agent.install --from uses url-derived lock key (no agent:<name>)", () => {
    const r = buildArgv({
      command: "agent.install",
      withSkills: false,
      platforms: [],
      from: "https://x/y/z.git",
    });
    // Without a name we lock on the from URL to keep concurrent installs
    // of the same remote serialized. CLI side also takes a filesystem lock.
    expect(r.lockKeys).toEqual(["agent-install:https://x/y/z.git"]);
  });

  it("local agent.install (no from) preserves the prior argv shape exactly", () => {
    const r = buildArgv({
      command: "agent.install",
      name: "foo",
      platforms: ["opencode"],
      withSkills: false,
    });
    expect(r.argv).toEqual(["agent", "install", "foo", "--yes", "--platforms", "opencode"]);
    expect(r.lockKeys).toEqual(["agent:foo"]);
  });

  // ─── C4.2.5: skill.install --git-ref ───────────────────────────────────
  it("skill.install emits --git-ref (not --ref) when ref is set", () => {
    const r = buildArgv({
      command: "skill.install",
      from: "https://x/y/z.git",
      ref: "v1",
      targets: [],
    });
    expect(r.argv).toContain("--git-ref");
    expect(r.argv).toContain("v1");
    expect(r.argv).not.toContain("--ref");
    expect(r.argv).toContain("--from");
  });

  it("skill.install omits --git-ref when ref is undefined", () => {
    const r = buildArgv({
      command: "skill.install",
      from: "https://x/y/z.git",
      targets: [],
    });
    expect(r.argv).toContain("--from");
    expect(r.argv).not.toContain("--git-ref");
  });

  it("skill.install local-name path unaffected by ref support", () => {
    const r = buildArgv({
      command: "skill.install",
      name: "architect",
      targets: [],
    });
    expect(r.argv).toEqual(["skill", "install", "architect"]);
  });

  // ─── C4.2.6: agent-sync / skill-sync builders ──────────────────────────
  it("agent.sync builds [agent, sync, name] with agent:<name> lock", () => {
    const r = buildArgv({ command: "agent.sync", name: "alpha" });
    expect(r.argv).toEqual(["agent", "sync", "alpha"]);
    expect(r.lockKeys).toEqual(["agent:alpha"]);
  });

  it("skill.sync builds [skill, sync, name] with skill:<name>+global:skills lock", () => {
    const r = buildArgv({ command: "skill.sync", name: "architect" });
    expect(r.argv).toEqual(["skill", "sync", "architect"]);
    // Mirror skill.install's dual-lock so sync serializes against installs.
    expect(r.lockKeys).toEqual(["skill:architect", "global:skills"]);
  });
});
