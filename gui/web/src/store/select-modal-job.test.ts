import { describe, expect, it } from "vitest";
import { selectModalJob } from "./select-modal-job";

describe("selectModalJob", () => {
  it("returns the only running job", () => {
    expect(selectModalJob(["a"], {})).toBe("a");
  });

  it("returns undefined when nothing is active", () => {
    expect(selectModalJob([], {})).toBeUndefined();
  });

  it("prefers the oldest exited job over running jobs", () => {
    // active is most-recent-first: ["new-running", "older-exited"]
    expect(selectModalJob(["new-running", "older-exited"], { "older-exited": { code: 0 } })).toBe(
      "older-exited",
    );
  });

  it("when multiple jobs have exited, returns the oldest (last in active)", () => {
    expect(
      selectModalJob(["c", "b", "a"], { a: { code: 0 }, b: { code: 1 }, c: { code: 0 } }),
    ).toBe("a");
  });

  it("falls back to active[0] (newest running) when none have exited", () => {
    expect(selectModalJob(["b", "a"], {})).toBe("b");
  });
});
