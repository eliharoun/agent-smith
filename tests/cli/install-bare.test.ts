import { describe, expect, test } from "bun:test";
import { installBareHelpfulError } from "../../src/cli/commands/install";
import { SmithError } from "../../src/core/smith-error";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

describe("cli/install — bare invocation", () => {
  test("with agents present: lists names + suggests install-all", async () => {
    let caught: unknown;
    try {
      await installBareHelpfulError({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [fakeBundle("alpha"), fakeBundle("beta"), fakeBundle("gamma")],
          failures: [],
        }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("usage-error");
    if (e.payload.code === "usage-error") {
      expect(e.payload.message).toContain("alpha");
      expect(e.payload.message).toContain("beta");
      expect(e.payload.message).toContain("gamma");
      expect(e.payload.message.toLowerCase()).toContain("missing agent name");
      expect(e.payload.suggestedCommand).toContain("agent install-all");
    }
  });

  test("with zero agents: suggests init-agent rather than install-all", async () => {
    let caught: unknown;
    try {
      await installBareHelpfulError({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("usage-error");
    if (e.payload.code === "usage-error") {
      expect(e.payload.message.toLowerCase()).toContain("no agents");
      expect(e.payload.suggestedCommand).toContain("agent init");
      expect(e.payload.suggestedCommand).not.toContain("install-all");
    }
  });

  test("with one agent: suggests installing it directly (not install-all)", async () => {
    // Updated contract: when only one agent is registered, the natural
    // next action is to install that one. Suggesting install-all in that
    // case is technically equivalent but reads as more abstract — and
    // for new users (fresh `bash bin/install` only registers
    // agent-smith), the "Try: install-all" footer encouraged a different
    // command than the one their context implies.
    let caught: unknown;
    try {
      await installBareHelpfulError({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [fakeBundle("solo")], failures: [] }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    if (e.payload.code === "usage-error") {
      // The body still mentions both options so the user learns
      // install-all exists.
      expect(e.payload.message).toContain("solo");
      expect(e.payload.message).toContain("install-all");
      // The "Try:" footer points at the concrete one-agent action.
      expect(e.payload.suggestedCommand).toBe("smith agent install solo");
    }
  });

  test("agents are listed in stable, sorted order", async () => {
    let caught: unknown;
    try {
      await installBareHelpfulError({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [fakeBundle("zeta"), fakeBundle("alpha"), fakeBundle("mu")],
          failures: [],
        }),
      });
    } catch (e) {
      caught = e;
    }
    const e = caught as SmithError;
    if (e.payload.code === "usage-error") {
      const idxAlpha = e.payload.message.indexOf("alpha");
      const idxMu = e.payload.message.indexOf("mu");
      const idxZeta = e.payload.message.indexOf("zeta");
      expect(idxAlpha).toBeLessThan(idxMu);
      expect(idxMu).toBeLessThan(idxZeta);
    }
  });
});
