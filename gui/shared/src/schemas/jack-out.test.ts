import { describe, expect, it } from "bun:test";
import { JackOutDryRun } from "./jack-out";

describe("JackOutDryRun", () => {
  it("accepts a dry-run result with lines", () => {
    expect(
      JackOutDryRun.safeParse({
        rawOutput: "Installed agents (2 files):\n    /a\n    /b\n",
        lines: ["    /a", "    /b"],
      }).success,
    ).toBe(true);
  });
  it("accepts an empty dry-run (nothing installed)", () => {
    expect(
      JackOutDryRun.safeParse({ rawOutput: "DRY RUN — no changes made.\n", lines: [] }).success,
    ).toBe(true);
  });
  it("rejects missing fields", () => {
    expect(JackOutDryRun.safeParse({ rawOutput: "x" }).success).toBe(false);
    expect(JackOutDryRun.safeParse({ lines: [] }).success).toBe(false);
  });
});
