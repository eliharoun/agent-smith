import { describe, expect, it, spyOn } from "bun:test";
import { knowledgeValidate } from "../../src/cli/commands/knowledge/validate";
import { SmithError } from "../../src/core/smith-error";

describe("knowledgeValidate", () => {
  it("returns 0 when all bundles' knowledge blocks are valid", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const code = await knowledgeValidate(undefined, {
      loadAllBundles: async () => ({
        bundles: [
          {
            config: {
              name: "good",
              description: "Use it.",
              targets: ["opencode"],
              modelTier: "balanced",
              knowledge: {
                sources: [{ id: "x", type: "file", path: "./x.md", delivery: "inline" }],
              },
            },
            source: { kind: "user-global", rootPath: "/x", label: "user-global" },
            bundlePath: "/x/good",
            files: { identity: "", expertise: "", soul: "", user: "" },
          } as never,
        ],
        failures: [],
      }),
    });
    expect(code).toBe(0);
    log.mockRestore();
  });

  it("throws partial-failure SmithError when any bundle's knowledge has errors", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const err = await knowledgeValidate(undefined, {
      loadAllBundles: async () => ({
        bundles: [
          {
            config: {
              name: "bad",
              description: "Use it.",
              targets: ["opencode"],
              modelTier: "balanced",
              knowledge: {
                sources: [
                  { id: "n", type: "npm", package: "lodash", delivery: "file" },
                ],
              },
            },
            source: { kind: "user-global", rootPath: "/x", label: "user-global" },
            bundlePath: "/x/bad",
            files: { identity: "", expertise: "", soul: "", user: "" },
          } as never,
        ],
        failures: [],
      }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("partial-failure");
    expect(err.payload.operation).toBe("knowledge validate");
    expect(err.payload.failed).toBeGreaterThan(0);
    expect(err.payload.details.some((d: string) => d.startsWith("bad:"))).toBe(true);
    logSpy.mockRestore();
  });

  it("aggregates load failures into knowledge validate partial-failure", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const err = await knowledgeValidate(undefined, {
      loadAllBundles: async () => ({
        bundles: [
          {
            config: {
              name: "good",
              description: "Use it.",
              targets: ["opencode"],
              modelTier: "balanced",
              knowledge: {
                sources: [{ id: "x", type: "file", path: "./x.md", delivery: "inline" }],
              },
            },
            source: { kind: "user-global", rootPath: "/x", label: "user-global" },
            bundlePath: "/x/good",
            files: { identity: "", expertise: "", soul: "", user: "" },
          } as never,
        ],
        failures: [
          {
            sourceKind: "user-global",
            sourceLabel: "user-global",
            bundlePath: "/x/broken",
            reason: "config invalid",
          },
        ],
      }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("partial-failure");
    expect(err.payload.succeeded).toBe(1);
    expect(err.payload.failed).toBe(1);
    expect(
      err.payload.details.some((d: string) => d.includes("/x/broken") && d.includes("config invalid")),
    ).toBe(true);
    logSpy.mockRestore();
  });
});
