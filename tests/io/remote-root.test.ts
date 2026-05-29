import { describe, expect, test } from "bun:test";
import { defaultRemoteRoot } from "../../src/io/remote-root";

describe("defaultRemoteRoot", () => {
  test("returns <xdgStateHome>/remote honoring XDG_STATE_HOME", () => {
    const original = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = "/tmp/xdg-state-test";
    try {
      expect(defaultRemoteRoot()).toBe("/tmp/xdg-state-test/agent-smith/remote");
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
    }
  });
});
