import { describe, expect, test } from "bun:test";
import { readConsentChoice } from "../../src/cli/prompt";

describe("readConsentChoice", () => {
  test("returns 'yes' on Y/y/empty (default)", async () => {
    expect(await readConsentChoice({ read: async () => "" })).toBe("yes");
    expect(await readConsentChoice({ read: async () => "Y" })).toBe("yes");
    expect(await readConsentChoice({ read: async () => "y" })).toBe("yes");
    expect(await readConsentChoice({ read: async () => "yes" })).toBe("yes");
  });

  test("returns 'no' on N/n/no", async () => {
    expect(await readConsentChoice({ read: async () => "n" })).toBe("no");
    expect(await readConsentChoice({ read: async () => "N" })).toBe("no");
    expect(await readConsentChoice({ read: async () => "no" })).toBe("no");
  });

  test("returns 'details' on d/details", async () => {
    expect(await readConsentChoice({ read: async () => "d" })).toBe("details");
    expect(await readConsentChoice({ read: async () => "details" })).toBe(
      "details",
    );
  });

  test("re-prompts on garbage input", async () => {
    const responses = ["maybe", "garbage", "y"];
    let i = 0;
    const got = await readConsentChoice({ read: async () => responses[i++]! });
    expect(got).toBe("yes");
    expect(i).toBe(3);
  });
});
