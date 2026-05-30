import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { stateHome } from "../../src/io/state-home";

describe("stateHome", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  beforeEach(() => {
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it("falls back to $HOME/.config/agent-smith when XDG_CONFIG_HOME unset", () => {
    expect(stateHome()).toBe(join(homedir(), ".config", "agent-smith"));
  });

  it("falls back to $HOME/.config/agent-smith when XDG_CONFIG_HOME is empty", () => {
    process.env.XDG_CONFIG_HOME = "";
    expect(stateHome()).toBe(join(homedir(), ".config", "agent-smith"));
  });

  it("honors XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-fake";
    expect(stateHome()).toBe(join("/tmp/xdg-fake", "agent-smith"));
  });

  it("is lazy: each call reads env at call time", () => {
    process.env.XDG_CONFIG_HOME = "/a";
    const a = stateHome();
    process.env.XDG_CONFIG_HOME = "/b";
    const b = stateHome();
    expect(a).toBe(join("/a", "agent-smith"));
    expect(b).toBe(join("/b", "agent-smith"));
  });
});

import {
  canonicalRegistryPath,
  canonicalUserPath,
  defaultRegistry,
} from "../../src/io/registry";
import { canonicalSkillRegistryPath } from "../../src/io/skill-registry";

describe("canonical paths honor XDG_CONFIG_HOME", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  beforeEach(() => {
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it("canonicalRegistryPath() routes through stateHome()", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/x";
    expect(canonicalRegistryPath()).toBe("/tmp/x/agent-smith/registry.json");
  });

  it("canonicalUserPath() routes through stateHome()", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/x";
    expect(canonicalUserPath()).toBe("/tmp/x/agent-smith/USER.md");
  });

  it("canonicalSkillRegistryPath() routes through stateHome()", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/x";
    expect(canonicalSkillRegistryPath()).toBe("/tmp/x/agent-smith/skill-catalogs.json");
  });

  it("defaultRegistry() embeds stateHome()-relative agents path", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/x";
    const reg = defaultRegistry();
    const userGlobal = reg.sources.find((s) => s.kind === "user-global");
    expect(userGlobal?.rootPath).toBe("/tmp/x/agent-smith/agents");
  });
});
