import { describe, expect, test } from "bun:test";
import { promptMultiSelect } from "../../src/cli/multi-select";

const items = [
  { label: "alpha" },
  { label: "beta", annotation: "[installed]" },
  { label: "gamma" },
];

function reader(...lines: string[]): () => Promise<string> {
  let i = 0;
  return async () => lines[i++] ?? "";
}

describe("promptMultiSelect", () => {
  test("'all' selects every item except [installed]-annotated", async () => {
    const picked = await promptMultiSelect(items, { read: reader("all"), print: () => {} });
    expect(picked).toEqual([0, 2]);
  });
  test("'*all' includes already-installed items", async () => {
    const picked = await promptMultiSelect(items, { read: reader("*all"), print: () => {} });
    expect(picked).toEqual([0, 1, 2]);
  });
  test("comma list maps to zero-based indices", async () => {
    const picked = await promptMultiSelect(items, { read: reader("1,3"), print: () => {} });
    expect(picked).toEqual([0, 2]);
  });
  test("empty re-prompts unless defaultAll", async () => {
    const picked = await promptMultiSelect(items, { read: reader("", "2"), print: () => {} });
    expect(picked).toEqual([1]);
    const all = await promptMultiSelect(items, { read: reader(""), print: () => {}, defaultAll: true });
    expect(all).toEqual([0, 2]);
  });
  test("'none' returns empty", async () => {
    const picked = await promptMultiSelect(items, { read: reader("none"), print: () => {} });
    expect(picked).toEqual([]);
  });
  test("out-of-range re-prompts", async () => {
    const picked = await promptMultiSelect(items, { read: reader("9", "1"), print: () => {} });
    expect(picked).toEqual([0]);
  });
});
