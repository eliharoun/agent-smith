import { describe, expect, test } from "bun:test";
import { validate } from "../../src/cli/commands/validate";
import { SmithError } from "../../src/core/smith-error";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

describe("cli/validate", () => {
  test("unknown agent name throws not-found SmithError", async () => {
    let caught: unknown;
    try {
      await validate({
        name: "nonexistent",
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        print: () => {},
        printErr: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("not-found");
    if (e.payload.code === "not-found") {
      expect(e.payload.identifier).toBe("nonexistent");
    }
  });

  test("no agents found at all (no name filter) returns exit 1", async () => {
    const printed: string[] = [];
    const code = await validate({
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(1);
    expect(printed.some((m) => m.includes("No agent found"))).toBe(true);
  });

  test("happy path: one valid bundle prints PASS and exits 0", async () => {
    const printed: string[] = [];
    const code = await validate({
      name: "good",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("good")], failures: [] }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    expect(printed.some((m) => m.includes("PASS") && m.includes("good"))).toBe(true);
  });

  test("name filter narrows to one bundle even when registry has many", async () => {
    const printed: string[] = [];
    const code = await validate({
      name: "wanted",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("other-1"), fakeBundle("wanted"), fakeBundle("other-2")],
        failures: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    const passLines = printed.filter((m) => m.includes("PASS"));
    expect(passLines).toHaveLength(1);
    expect(passLines[0]).toContain("wanted");
  });

  test("throws partial-failure when target failed to load", async () => {
    let caught: unknown;
    try {
      await validate({
        name: "foo",
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [],
          failures: [
            {
              sourceKind: "user-global" as const,
              sourceLabel: "test",
              bundlePath: "/cat/foo",
              reason: "config invalid",
            },
          ],
        }),
        print: () => {},
        printErr: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("partial-failure");
    if (e.payload.code === "partial-failure") {
      expect(e.payload.failed).toBe(1);
      expect(e.payload.details[0]).toContain("foo");
      expect(e.payload.details[0]).toContain("config invalid");
    }
  });

  test("named: prints unrelated load failures as warnings then proceeds with target", async () => {
    const warnings: string[] = [];
    const printed: string[] = [];
    const code = await validate({
      name: "good",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("good")],
        failures: [
          {
            sourceKind: "user-global" as const,
            sourceLabel: "test",
            bundlePath: "/cat/other",
            reason: "boom",
          },
        ],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => warnings.push(m),
    });
    expect(code).toBe(0);
    expect(warnings.some((w) => w.includes("/cat/other") && w.includes("boom"))).toBe(true);
  });

  test("no name: aggregates load failures into partial-failure", async () => {
    const printed: string[] = [];
    let caught: unknown;
    try {
      await validate({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [fakeBundle("good")],
          failures: [
            {
              sourceKind: "user-global" as const,
              sourceLabel: "test",
              bundlePath: "/cat/bad",
              reason: "broken",
            },
          ],
        }),
        print: (m) => printed.push(m),
        printErr: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("partial-failure");
    if (e.payload.code === "partial-failure") {
      expect(e.payload.succeeded).toBe(1);
      expect(e.payload.failed).toBe(1);
      expect(e.payload.details.some((d) => d.includes("/cat/bad") && d.includes("broken"))).toBe(true);
    }
    // Good bundle still validated inline before aggregation.
    expect(printed.some((m) => m.includes("PASS") && m.includes("good"))).toBe(true);
  });

  test("no name: returns 0 when all bundles validate and no load failures", async () => {
    const printed: string[] = [];
    const code = await validate({
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("a"), fakeBundle("b")],
        failures: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    expect(printed.filter((m) => m.includes("PASS"))).toHaveLength(2);
  });

  test("no name: surfaces validation failures in partial-failure details", async () => {
    const printed: string[] = [];
    let caught: unknown;
    try {
      await validate({
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          // Empty `identity` triggers a validator error (file empty/near-empty).
          bundles: [fakeBundle("good"), fakeBundle("bad", { identity: "" })],
          failures: [],
        }),
        print: (m) => printed.push(m),
        printErr: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("partial-failure");
    if (e.payload.code === "partial-failure") {
      expect(e.payload.succeeded).toBe(1);
      expect(e.payload.failed).toBe(1);
      expect(
        e.payload.details.some((d) => d.includes("bad") && d.includes("validation")),
      ).toBe(true);
    }
    // Inline FAIL line still printed for humans.
    expect(printed.some((m) => m.includes("FAIL") && m.includes("bad"))).toBe(true);
  });

  test("surfaces knowledge deprecation warning for type: url sources", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "smith-val-depr-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "depr",
        description: "Use to test deprecation.",
        targets: ["opencode"],
        modelTier: "balanced",
        knowledge: { sources: [{ id: "old-url", type: "url", url: "https://example.com" }] },
      }),
    );
    const printed: string[] = [];
    const code = await validate({
      name: "depr",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("depr", { bundlePath: dir })],
        failures: [],
      }),
      print: (m) => printed.push(m),
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(printed.some((m) => m.includes("type: webpage"))).toBe(true);
  });
});
