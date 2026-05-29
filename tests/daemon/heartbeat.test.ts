import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { heartbeatPath } from "../../src/daemon/heartbeat";

describe("heartbeatPath", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    delete process.env.XDG_STATE_HOME;
  });
  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdg;
  });

  it("falls back to $HOME/.local/state/agent-smith/daemon.heartbeat.json when XDG_STATE_HOME unset", () => {
    expect(heartbeatPath()).toBe(
      join(homedir(), ".local", "state", "agent-smith", "daemon.heartbeat.json"),
    );
  });

  it("falls back to $HOME/.local/state/agent-smith/daemon.heartbeat.json when XDG_STATE_HOME is empty", () => {
    process.env.XDG_STATE_HOME = "";
    expect(heartbeatPath()).toBe(
      join(homedir(), ".local", "state", "agent-smith", "daemon.heartbeat.json"),
    );
  });

  it("honors XDG_STATE_HOME when set", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg-hb";
    expect(heartbeatPath()).toBe("/tmp/xdg-hb/agent-smith/daemon.heartbeat.json");
  });

  it("is lazy: each call reads env at call time", () => {
    process.env.XDG_STATE_HOME = "/a";
    const a = heartbeatPath();
    process.env.XDG_STATE_HOME = "/b";
    const b = heartbeatPath();
    expect(a).toBe("/a/agent-smith/daemon.heartbeat.json");
    expect(b).toBe("/b/agent-smith/daemon.heartbeat.json");
  });
});
