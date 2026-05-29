import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultAgentSmithHome, defaultInstallPaths } from "../../src/cli/install-paths";

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
  beforeEach(() => { delete process.env.XDG_CONFIG_HOME; });
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
