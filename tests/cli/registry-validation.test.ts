import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sniffPath, verifyGitRemote } from "../../src/cli/registry-validation";

describe("sniffPath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-sniff-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns exists=false for a path that doesn't exist", async () => {
    const result = await sniffPath(join(dir, "nope"));
    expect(result.exists).toBe(false);
    expect(result.agentBundles).toBe(0);
    expect(result.skillBundles).toBe(0);
  });

  test("counts agent bundles (subdirs with agent.config.json)", async () => {
    await mkdir(join(dir, "agent-a"), { recursive: true });
    await writeFile(join(dir, "agent-a/agent.config.json"), "{}");
    await mkdir(join(dir, "agent-b"), { recursive: true });
    await writeFile(join(dir, "agent-b/agent.config.json"), "{}");
    await mkdir(join(dir, "not-an-agent"), { recursive: true });
    const result = await sniffPath(dir);
    expect(result.exists).toBe(true);
    expect(result.agentBundles).toBe(2);
    expect(result.skillBundles).toBe(0);
  });

  test("counts skill bundles (subdirs with SKILL.md and no agent.config.json)", async () => {
    await mkdir(join(dir, "skill-a"), { recursive: true });
    await writeFile(join(dir, "skill-a/SKILL.md"), "# skill");
    await mkdir(join(dir, "skill-b"), { recursive: true });
    await writeFile(join(dir, "skill-b/SKILL.md"), "# skill");
    const result = await sniffPath(dir);
    expect(result.agentBundles).toBe(0);
    expect(result.skillBundles).toBe(2);
  });

  test("a subdir with both agent.config.json and SKILL.md counts as an agent bundle only", async () => {
    // Defensive: shouldn't happen in practice, but if it does, the
    // agent.config.json marker wins (sniffer is biased toward the
    // registry the user is trying to register into).
    await mkdir(join(dir, "weird"), { recursive: true });
    await writeFile(join(dir, "weird/agent.config.json"), "{}");
    await writeFile(join(dir, "weird/SKILL.md"), "# skill");
    const result = await sniffPath(dir);
    expect(result.agentBundles).toBe(1);
    expect(result.skillBundles).toBe(0);
  });

  test("ignores non-directory entries", async () => {
    await writeFile(join(dir, "loose-file.md"), "hi");
    const result = await sniffPath(dir);
    expect(result.exists).toBe(true);
    expect(result.agentBundles).toBe(0);
    expect(result.skillBundles).toBe(0);
  });

  test("isSingleAgentBundle=true when rootPath itself contains agent.config.json", async () => {
    // DW-5: remote installs (smith agent install --from <url>) clone single-
    // bundle git repos whose agent.config.json sits at the top of the clone.
    // sniffPath must surface that shape so the registry-hygiene check in
    // run-doctor.ts does not falsely warn 'contains no agent bundles'.
    await writeFile(join(dir, "agent.config.json"), "{}");
    const result = await sniffPath(dir);
    expect(result.exists).toBe(true);
    expect(result.isSingleAgentBundle).toBe(true);
    expect(result.isSingleSkillBundle).toBe(false);
  });

  test("isSingleSkillBundle=true when rootPath itself contains SKILL.md (and no agent.config.json)", async () => {
    await writeFile(join(dir, "SKILL.md"), "# skill");
    const result = await sniffPath(dir);
    expect(result.exists).toBe(true);
    expect(result.isSingleAgentBundle).toBe(false);
    expect(result.isSingleSkillBundle).toBe(true);
  });

  test("isSingleAgentBundle wins when rootPath has both top-level agent.config.json and SKILL.md", async () => {
    await writeFile(join(dir, "agent.config.json"), "{}");
    await writeFile(join(dir, "SKILL.md"), "# skill");
    const result = await sniffPath(dir);
    expect(result.isSingleAgentBundle).toBe(true);
    expect(result.isSingleSkillBundle).toBe(false);
  });

  test("isSingleAgentBundle=false for a pure catalog (subdir bundles only)", async () => {
    await mkdir(join(dir, "agent-a"), { recursive: true });
    await writeFile(join(dir, "agent-a/agent.config.json"), "{}");
    const result = await sniffPath(dir);
    expect(result.agentBundles).toBe(1);
    expect(result.isSingleAgentBundle).toBe(false);
    expect(result.isSingleSkillBundle).toBe(false);
  });

  test("counts nested skill bundles (skills/<name>/SKILL.md convention)", async () => {
    // Mirrors the superpowers repo layout: skills are nested under a
    // `skills/` subdirectory rather than at the catalog root.
    await mkdir(join(dir, "skills", "brainstorming"), { recursive: true });
    await writeFile(join(dir, "skills", "brainstorming", "SKILL.md"), "# skill");
    await mkdir(join(dir, "skills", "debugging"), { recursive: true });
    await writeFile(join(dir, "skills", "debugging", "SKILL.md"), "# skill");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "README.md"), "# docs");
    const result = await sniffPath(dir);
    expect(result.skillBundles).toBe(2);
    expect(result.emptyBundleDirs).toEqual([]);
  });

  // Bug B defense in depth: pre-fix, writeRefreshManifest mkdir'd a
  // subdir under <stateHome>/agents/<name>/ even when the bundle source
  // was the synthetic self-source. That left phantom dirs containing
  // ONLY refresh-manifest.json — which the doctor sniff misclassified as
  // "leftover from aborted `smith agent init`". The path move makes this
  // unreachable for new installs, but the sniff must still recognise
  // legacy state and NOT flag it.
  test("does not flag a subdir whose only content is refresh-manifest.json (Bug B legacy)", async () => {
    await mkdir(join(dir, "ghost"), { recursive: true });
    await writeFile(join(dir, "ghost", "refresh-manifest.json"), "{}");
    const result = await sniffPath(dir);
    expect(result.emptyBundleDirs).toEqual([]);
    expect(result.agentBundles).toBe(0);
    expect(result.skillBundles).toBe(0);
  });
});

describe("verifyGitRemote", () => {
  test("ok when path is a git repo and one remote matches", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/some/repo";
      if (args[0] === "remote") return "origin\thttps://example.com/foo.git (fetch)\norigin\thttps://example.com/foo.git (push)";
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const result = await verifyGitRemote("/some/repo", "https://example.com/foo.git", runGit);
    expect(result.ok).toBe(true);
  });

  test("ok when expected URL matches after .git stripping", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/some/repo";
      if (args[0] === "remote") return "origin\thttps://example.com/foo (fetch)";
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const result = await verifyGitRemote("/some/repo", "https://example.com/foo.git", runGit);
    expect(result.ok).toBe(true);
  });

  test("ok when expected URL matches after trailing slash stripping", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/some/repo";
      if (args[0] === "remote") return "origin\thttps://example.com/foo (fetch)";
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const result = await verifyGitRemote("/some/repo", "https://example.com/foo/", runGit);
    expect(result.ok).toBe(true);
  });

  test("not-a-git-repo when rev-parse throws", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") throw new Error("fatal: not a git repository");
      throw new Error("unreachable");
    };
    const result = await verifyGitRemote("/not/a/repo", "https://example.com/foo.git", runGit);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not-a-git-repo");
  });

  test("remote-mismatch when no remote matches; returns found list", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/some/repo";
      if (args[0] === "remote") return "origin\thttps://example.com/other.git (fetch)\nupstream\thttps://example.com/upstream.git (fetch)";
      throw new Error("unreachable");
    };
    const result = await verifyGitRemote("/some/repo", "https://example.com/foo.git", runGit);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("remote-mismatch");
    if (result.reason !== "remote-mismatch") throw new Error("unreachable");
    expect(result.found).toEqual([
      { name: "origin", url: "https://example.com/other.git" },
      { name: "upstream", url: "https://example.com/upstream.git" },
    ]);
  });

  test("dedupes fetch/push lines for the same remote", async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === "rev-parse") return "/some/repo";
      if (args[0] === "remote") return "origin\thttps://example.com/other.git (fetch)\norigin\thttps://example.com/other.git (push)";
      throw new Error("unreachable");
    };
    const result = await verifyGitRemote("/some/repo", "https://example.com/foo.git", runGit);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    if (result.reason !== "remote-mismatch") throw new Error("unreachable");
    expect(result.found.length).toBe(1);
  });
});
