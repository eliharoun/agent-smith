import { describe, expect, test } from "bun:test";
import type { KnowledgeManifest } from "../../src/core/knowledge/types";
import { summarizeKnowledgeStage } from "../../src/io/knowledge-summary";

const currentManifest: KnowledgeManifest = {
  schemaVersion: 1,
  renderedAt: "2026-05-17T12:00:00.000Z",
  sources: [
    {
      id: "guide",
      scope: "agent",
      type: "file",
      delivery: "file",
      files: [
        { path: "sources/guide/01.md", sha256: "aaa", bytes: 100 },
        { path: "sources/guide/02.md", sha256: "bbb", bytes: 200 },
      ],
      tokensInline: 0,
    },
  ],
  totals: { tokensInline: 0, tokensInlineBudget: 4000, files: 2, bytes: 300 },
};

describe("summarizeKnowledgeStage", () => {
  test("no prior manifest: all sources marked changed", async () => {
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => null,
    });
    expect(summary.agent).toBe("foo");
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toEqual({
      id: "guide",
      delivery: "file",
      files: 2,
      bytes: 300,
      changed: true,
    });
    expect(summary.totals).toEqual({
      files: 2,
      bytes: 300,
      tokensInline: 0,
      tokensInlineBudget: 4000,
      hasInline: false,
    });
  });

  test("prior matches current: all sources marked unchanged", async () => {
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => currentManifest,
    });
    expect(summary.sources.every((s) => !s.changed)).toBe(true);
  });

  test("content edit (sha changes): that source marked changed", async () => {
    const prior: KnowledgeManifest = {
      ...currentManifest,
      sources: [
        {
          ...currentManifest.sources[0]!,
          files: [
            { path: "sources/guide/01.md", sha256: "OLD", bytes: 100 },
            { path: "sources/guide/02.md", sha256: "bbb", bytes: 200 },
          ],
        },
      ],
    };
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => prior,
    });
    expect(summary.sources[0]?.changed).toBe(true);
  });

  test("delivery flip: that source marked changed", async () => {
    const prior: KnowledgeManifest = {
      ...currentManifest,
      sources: [{ ...currentManifest.sources[0]!, delivery: "inline" }],
    };
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => prior,
    });
    expect(summary.sources[0]?.changed).toBe(true);
  });

  test("file added to source: that source marked changed", async () => {
    const prior: KnowledgeManifest = {
      ...currentManifest,
      sources: [
        {
          ...currentManifest.sources[0]!,
          files: [{ path: "sources/guide/01.md", sha256: "aaa", bytes: 100 }],
        },
      ],
    };
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => prior,
    });
    expect(summary.sources[0]?.changed).toBe(true);
  });

  test("file removed from source: that source marked changed", async () => {
    const prior: KnowledgeManifest = {
      ...currentManifest,
      sources: [
        {
          ...currentManifest.sources[0]!,
          files: [
            { path: "sources/guide/01.md", sha256: "aaa", bytes: 100 },
            { path: "sources/guide/02.md", sha256: "bbb", bytes: 200 },
            { path: "sources/guide/03.md", sha256: "ccc", bytes: 50 },
          ],
        },
      ],
    };
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest,
      readPriorManifest: async () => prior,
    });
    expect(summary.sources[0]?.changed).toBe(true);
  });

  test("hasInline true when any source delivery=inline", async () => {
    const cur: KnowledgeManifest = {
      ...currentManifest,
      sources: [{ ...currentManifest.sources[0]!, delivery: "inline", tokensInline: 250 }],
      totals: { ...currentManifest.totals, tokensInline: 250 },
    };
    const summary = await summarizeKnowledgeStage({
      agent: "foo",
      currentManifest: cur,
      readPriorManifest: async () => null,
    });
    expect(summary.totals.hasInline).toBe(true);
    expect(summary.totals.tokensInline).toBe(250);
  });

  test("defaultReadPriorManifest: missing file returns null", async () => {
    const { defaultReadPriorManifest } = await import("../../src/io/knowledge-summary");
    const reader = defaultReadPriorManifest("/nonexistent/path/_manifest.json");
    expect(await reader()).toBeNull();
  });

  test("defaultReadPriorManifest: corrupt JSON returns null", async () => {
    const { defaultReadPriorManifest } = await import("../../src/io/knowledge-summary");
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "smith-test-"));
    try {
      const p = join(dir, "_manifest.json");
      await writeFile(p, "{ not valid json", "utf8");
      const reader = defaultReadPriorManifest(p);
      expect(await reader()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
