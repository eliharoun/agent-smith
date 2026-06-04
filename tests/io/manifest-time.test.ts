import { describe, it, expect } from "bun:test";
import { pinnedIso } from "../../src/io/manifest-time";

describe("pinnedIso", () => {
  it("strips milliseconds from an ISO timestamp", () => {
    expect(pinnedIso(new Date("2026-06-04T15:00:00.123Z"))).toBe("2026-06-04T15:00:00Z");
  });

  it("passes through a timestamp with no milliseconds", () => {
    expect(pinnedIso(new Date("2026-06-04T15:00:00.000Z"))).toBe("2026-06-04T15:00:00Z");
  });

  it("handles midnight", () => {
    expect(pinnedIso(new Date("2026-01-01T00:00:00.999Z"))).toBe("2026-01-01T00:00:00Z");
  });
});
