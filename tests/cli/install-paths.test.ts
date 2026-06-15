import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  defaultAgentSmithHome,
  defaultInstallPaths,
  resolveAgentsMdRoot,
} from "../../src/cli/install-paths";
import type { Source } from "../../src/core/types";

const src = (kind: Source["kind"], rootPath: string): Source => ({ kind, rootPath, label: "t" });

describe("resolveAgentsMdRoot", () => {
  test("user-global → the configured user-global root (paths['agents-md'])", () => {
    expect(resolveAgentsMdRoot(src("user-global", "/whatever/agents"), homedir())).toBe(homedir());
    // overridable (tests / custom home): user-global returns the passed root
    expect(resolveAgentsMdRoot(src("user-global", "/whatever/agents"), "/tmp/home")).toBe(
      "/tmp/home",
    );
  });
  test("project → source.rootPath (no dirname inference)", () => {
    expect(resolveAgentsMdRoot(src("project", "/proj/.agent-smith/agents"), "/tmp/home")).toBe(
      "/proj/.agent-smith/agents",
    );
  });
  test("registered → source.rootPath", () => {
    expect(resolveAgentsMdRoot(src("registered", "/cache/clones/repo/agents"), "/tmp/home")).toBe(
      "/cache/clones/repo/agents",
    );
  });
});

describe("cli/install-paths", () => {
  test("returns absolute paths for all three targets", () => {
    const p = defaultInstallPaths();
    expect(p.opencode).toMatch(/\.config\/opencode\/agents$/);
    expect(p["claude-code"]).toMatch(/\.claude\/agents$/);
    expect(p.codex).toMatch(/\.agents\/skills$/);
  });
});

describe("defaultAgentSmithHome honors XDG_CONFIG_HOME", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  beforeEach(() => {
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it("falls back to $HOME/.config/agent-smith when XDG unset", () => {
    expect(defaultAgentSmithHome()).toBe(join(homedir(), ".config", "agent-smith"));
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    expect(defaultAgentSmithHome()).toBe("/tmp/xdg-test/agent-smith");
  });

  it("treats empty XDG_CONFIG_HOME as unset", () => {
    process.env.XDG_CONFIG_HOME = "";
    expect(defaultAgentSmithHome()).toBe(join(homedir(), ".config", "agent-smith"));
  });
});
