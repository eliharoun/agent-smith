import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = Date.parse("2025-06-15T12:00:00Z");

  it("returns 'never' for null/undefined/invalid", () => {
    expect(relativeTime(undefined, now)).toBe("never");
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("not-a-date", now)).toBe("never");
  });

  it("returns 'now' for <1 minute", () => {
    expect(relativeTime("2025-06-15T11:59:30Z", now)).toBe("now");
  });

  it("returns minutes/hours/days/months/years", () => {
    expect(relativeTime("2025-06-15T11:55:00Z", now)).toBe("5m");
    expect(relativeTime("2025-06-15T10:00:00Z", now)).toBe("2h");
    expect(relativeTime("2025-06-13T12:00:00Z", now)).toBe("2d");
    expect(relativeTime("2025-04-15T12:00:00Z", now)).toBe("2mo");
    expect(relativeTime("2023-06-15T12:00:00Z", now)).toBe("2y");
  });
});
