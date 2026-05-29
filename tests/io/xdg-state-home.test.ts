import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { xdgStateHome } from "../../src/io/xdg-state-home";

describe("xdgStateHome", () => {
  test("returns <XDG_STATE_HOME>/agent-smith when env var set and non-empty", () => {
    const original = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = "/tmp/xdg-state-test";
    try {
      expect(xdgStateHome()).toBe("/tmp/xdg-state-test/agent-smith");
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
    }
  });

  test("treats empty XDG_STATE_HOME as unset (XDG semantics)", () => {
    const original = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = "";
    try {
      expect(xdgStateHome()).toBe(join(homedir(), ".local", "state", "agent-smith"));
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
    }
  });

  test("falls back to ~/.local/state/agent-smith when XDG_STATE_HOME undefined", () => {
    const original = process.env.XDG_STATE_HOME;
    delete process.env.XDG_STATE_HOME;
    try {
      expect(xdgStateHome()).toBe(join(homedir(), ".local", "state", "agent-smith"));
    } finally {
      if (original !== undefined) process.env.XDG_STATE_HOME = original;
    }
  });
});
