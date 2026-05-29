import { describe, expect, it } from "bun:test";
import { UpdatePreview } from "./update";

describe("UpdatePreview", () => {
  it("accepts up-to-date result", () => {
    expect(
      UpdatePreview.safeParse({
        commitsBehind: 0,
        alreadyUpToDate: true,
        rawOutput: "Already up to date with origin/main.",
      }).success,
    ).toBe(true);
  });
  it("accepts N-commits-behind result", () => {
    expect(
      UpdatePreview.safeParse({
        commitsBehind: 7,
        alreadyUpToDate: false,
        rawOutput: "smith update would pull 7 commit(s) ...",
      }).success,
    ).toBe(true);
  });
  it("rejects negative commitsBehind", () => {
    expect(
      UpdatePreview.safeParse({
        commitsBehind: -1,
        alreadyUpToDate: false,
        rawOutput: "x",
      }).success,
    ).toBe(false);
  });
});
