import { describe, expect, it } from "bun:test";
import { parseFieldsList, parsePagesList } from "../../src/cli/commands/knowledge/add";

describe("parsePagesList", () => {
  it("parses a single id reference", () => {
    expect(parsePagesList("id:42")).toEqual([{ id: 42 }]);
  });

  it("parses a mixed list of ids and titles", () => {
    expect(parsePagesList("id:42, Welcome Page, id:7")).toEqual([
      { id: 42 },
      "Welcome Page",
      { id: 7 },
    ]);
  });

  it("drops empty segments from trailing/extra commas", () => {
    expect(parsePagesList("id:1,,Page,")).toEqual([{ id: 1 }, "Page"]);
  });

  it("falls back to literal title for invalid id forms", () => {
    expect(parsePagesList("id:0, id:-5, id:abc, id:")).toEqual([
      "id:0",
      "id:-5",
      "id:abc",
      "id:",
    ]);
  });

  it("strips surrounding whitespace from segments", () => {
    expect(parsePagesList("  id:9  ,  My Page  ")).toEqual([{ id: 9 }, "My Page"]);
  });
});

describe("parseFieldsList", () => {
  it("parses a plain comma list", () => {
    expect(parseFieldsList("summary,status")).toEqual(["summary", "status"]);
  });

  it("passes through *all without special-casing", () => {
    expect(parseFieldsList("*all")).toEqual(["*all"]);
  });

  it("trims whitespace around segments", () => {
    expect(parseFieldsList("  summary , status  ")).toEqual(["summary", "status"]);
  });

  it("drops empty segments from trailing commas", () => {
    expect(parseFieldsList("summary,,,status,")).toEqual(["summary", "status"]);
  });
});
