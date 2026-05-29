import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { runtimeStateHome } from "../../src/io/runtime-state-home";

describe("runtimeStateHome", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    delete process.env.XDG_STATE_HOME;
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdg;
  });

  it("falls back to $HOME/.local/state/agent-smith when XDG_STATE_HOME unset", () => {
    expect(runtimeStateHome()).toBe(join(homedir(), ".local", "state", "agent-smith"));
  });

  it("falls back to $HOME/.local/state/agent-smith when XDG_STATE_HOME is empty", () => {
    process.env.XDG_STATE_HOME = "";
    expect(runtimeStateHome()).toBe(join(homedir(), ".local", "state", "agent-smith"));
  });

  it("honors XDG_STATE_HOME when set", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg-state-fake";
    expect(runtimeStateHome()).toBe(join("/tmp/xdg-state-fake", "agent-smith"));
  });

  it("re-evaluates env on each call (no module-load caching)", () => {
    process.env.XDG_STATE_HOME = "/a";
    const a = runtimeStateHome();
    process.env.XDG_STATE_HOME = "/b";
    const b = runtimeStateHome();
    expect(a).toBe(join("/a", "agent-smith"));
    expect(b).toBe(join("/b", "agent-smith"));
  });
});
