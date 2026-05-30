import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defaultCachePath } from "../../src/cli/commands/doctor";

describe("defaultCachePath", () => {
  let originalXdg: string | undefined;

  beforeEach(() => {
    originalXdg = process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = originalXdg;
    }
  });

  test("uses XDG_CACHE_HOME when set", () => {
    process.env.XDG_CACHE_HOME = "/custom/xdg";
    expect(defaultCachePath()).toBe("/custom/xdg/agent-smith/opencode-schema-cache.json");
  });

  test("falls back to ~/.cache when XDG_CACHE_HOME is unset", () => {
    delete process.env.XDG_CACHE_HOME;
    expect(defaultCachePath()).toBe(join(homedir(), ".cache/agent-smith/opencode-schema-cache.json"));
  });

  test("falls back to ~/.cache when XDG_CACHE_HOME is empty string", () => {
    process.env.XDG_CACHE_HOME = "";
    expect(defaultCachePath()).toBe(join(homedir(), ".cache/agent-smith/opencode-schema-cache.json"));
  });
});
