import { describe, expect, it } from "bun:test";
import { sparsePathsFor } from "../../../src/core/knowledge/sparse-paths";

describe("sparsePathsFor", () => {
  it("extracts the static directory prefix of a glob include", () => {
    expect(sparsePathsFor(undefined, ["src/**/*.ts"])).toEqual(["/src/"]);
  });

  it("handles multiple includes, deduped and descendant-collapsed", () => {
    expect(sparsePathsFor(undefined, ["packages/**", "packages/core/**"])).toEqual(["/packages/"]);
  });

  it("composes subpath with include prefixes", () => {
    expect(sparsePathsFor("docs", ["api/*.md"])).toEqual(["/docs/api/"]);
  });

  it("uses subpath alone when include is absent", () => {
    expect(sparsePathsFor("docs", undefined)).toEqual(["/docs/"]);
  });

  it("returns [] (no-sparse) when a glob has no static prefix", () => {
    expect(sparsePathsFor(undefined, ["**/*.md"])).toEqual([]);
  });

  it("returns [] (no-sparse) when neither subpath nor include is set", () => {
    expect(sparsePathsFor(undefined, undefined)).toEqual([]);
  });

  it("returns [] when ANY include lacks a static prefix (cannot safely narrow)", () => {
    expect(sparsePathsFor(undefined, ["src/**/*.ts", "*.md"])).toEqual([]);
  });

  it("passes a literal file include through without a trailing slash", () => {
    expect(sparsePathsFor(undefined, ["README.md"])).toEqual(["/README.md"]);
  });
});
