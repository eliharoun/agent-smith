import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  defaultAgentSmithHome,
  defaultCacheRoot,
  defaultGuiJobsPaths,
  defaultStateRoot,
  knowledgeManifestPathFor,
  refreshCacheDirFor,
  refreshManifestPathFor,
} from "./cache-paths";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CACHE_HOME;
  delete process.env.XDG_STATE_HOME;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("cache-paths", () => {
  it("honors XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/x";
    expect(defaultAgentSmithHome()).toBe("/x/agent-smith");
  });

  it("treats empty XDG_CONFIG_HOME as unset", () => {
    process.env.XDG_CONFIG_HOME = "";
    expect(defaultAgentSmithHome()).toMatch(/\.config\/agent-smith$/);
  });

  it("honors XDG_CACHE_HOME", () => {
    process.env.XDG_CACHE_HOME = "/c";
    expect(defaultCacheRoot()).toBe("/c/agent-smith");
  });

  it("honors XDG_STATE_HOME", () => {
    process.env.XDG_STATE_HOME = "/s";
    expect(defaultStateRoot()).toBe("/s/agent-smith");
  });

  it("treats empty XDG_STATE_HOME as unset (falls back to ~/.local/state)", () => {
    process.env.XDG_STATE_HOME = "";
    expect(defaultStateRoot()).toMatch(/\.local\/state\/agent-smith$/);
  });

  it("builds refreshCacheDir with safe fs name (strict regex matches CLI)", () => {
    // CONTRACT: must match safeFsName() in src/core/knowledge/refresh-cache.ts.
    // The CLI writes .meta.json files under this exact path; if these
    // sanitizers drift the GUI will read an empty directory while the
    // CLI happily writes elsewhere.
    expect(refreshCacheDirFor("foo/bar", "/c/agent-smith")).toBe(
      "/c/agent-smith/agents/foo-bar/sources",
    );
    expect(refreshCacheDirFor("a/b\\c@d e", "/c/agent-smith")).toBe(
      "/c/agent-smith/agents/a-b-c-d-e/sources",
    );
    expect(refreshCacheDirFor("kebab-case-name", "/c/agent-smith")).toBe(
      "/c/agent-smith/agents/kebab-case-name/sources",
    );
  });

  it("manifest paths apply the same strict sanitizer", () => {
    expect(refreshManifestPathFor("a/b", "/s")).toBe("/s/refresh/a-b/refresh-manifest.json");
    expect(knowledgeManifestPathFor("a/b", "/s")).toBe("/s/knowledge/a-b/_manifest.json");
  });
});

describe("defaultGuiJobsPaths", () => {
  it("derives both paths from an explicit state root", () => {
    expect(defaultGuiJobsPaths("/s/agent-smith")).toEqual({
      jsonlPath: "/s/agent-smith/gui-jobs.jsonl",
      outputDir: "/s/agent-smith/gui-jobs-output",
    });
  });

  it("falls back to XDG_STATE_HOME when no root is passed", () => {
    process.env.XDG_STATE_HOME = "/s";
    expect(defaultGuiJobsPaths()).toEqual({
      jsonlPath: "/s/agent-smith/gui-jobs.jsonl",
      outputDir: "/s/agent-smith/gui-jobs-output",
    });
  });
});
