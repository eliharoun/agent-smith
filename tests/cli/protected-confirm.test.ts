import { describe, expect, test } from "bun:test";
import { protectedConfirm, type ConfirmDeps } from "../../src/cli/commands/protected-confirm";

const baseDeps = (): ConfirmDeps => ({ prompt: async () => "n", log: () => {}, errLog: () => {} });

describe("protectedConfirm", () => {
  test("true on 'y'", async () => {
    const r = await protectedConfirm(
      { ...baseDeps(), prompt: async () => "y" },
      { entity: "agent-smith", verb: "uninstall", repoRoot: "/repo" },
    );
    expect(r.confirmed).toBe(true);
  });
  test("true on 'Y' (case-insensitive)", async () => {
    const r = await protectedConfirm(
      { ...baseDeps(), prompt: async () => "Y" },
      { entity: "agent-smith", verb: "uninstall", repoRoot: "/repo" },
    );
    expect(r.confirmed).toBe(true);
  });
  test("false on 'n' and empty (default no)", async () => {
    expect(
      (
        await protectedConfirm(
          { ...baseDeps(), prompt: async () => "n" },
          { entity: "agent-smith", verb: "uninstall", repoRoot: "/repo" },
        )
      ).confirmed,
    ).toBe(false);
    expect(
      (
        await protectedConfirm(
          { ...baseDeps(), prompt: async () => "" },
          { entity: "agent-smith", verb: "uninstall", repoRoot: "/repo" },
        )
      ).confirmed,
    ).toBe(false);
  });
  test("auto-confirms when SMITH_CLONE_CONFIRM_ALL=1", async () => {
    const prev = process.env.SMITH_CLONE_CONFIRM_ALL;
    process.env.SMITH_CLONE_CONFIRM_ALL = "1";
    try {
      const r = await protectedConfirm(baseDeps(), {
        entity: "agent-smith",
        verb: "uninstall",
        repoRoot: "/repo",
      });
      expect(r.confirmed).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SMITH_CLONE_CONFIRM_ALL;
      else process.env.SMITH_CLONE_CONFIRM_ALL = prev;
    }
  });
});
