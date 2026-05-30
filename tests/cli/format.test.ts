import { describe, expect, test } from "bun:test";
import { formatKnowledgeLines, prettyBytes } from "../../src/cli/format";
import type { KnowledgeSummary } from "../../src/io/knowledge-summary";

describe("prettyBytes", () => {
  test("0 bytes", () => {
    expect(prettyBytes(0)).toBe("0B");
  });
  test("under 1KB shows bytes", () => {
    expect(prettyBytes(500)).toBe("500B");
    expect(prettyBytes(1023)).toBe("1023B");
  });
  test("exactly 1KB", () => {
    expect(prettyBytes(1024)).toBe("1.0KB");
  });
  test("under 1MB shows KB with one decimal", () => {
    expect(prettyBytes(1536)).toBe("1.5KB");
    expect(prettyBytes(1024 * 1024 - 1)).toBe("1024.0KB");
  });
  test("exactly 1MB", () => {
    expect(prettyBytes(1024 * 1024)).toBe("1.0MB");
  });
  test("over 1MB shows MB with one decimal", () => {
    expect(prettyBytes(1024 * 1024 * 1.5)).toBe("1.5MB");
    expect(prettyBytes(1024 * 1024 * 312)).toBe("312.0MB");
  });
});

// Note: the test preload (tests/_setup/disable-self-source.ts) sets NO_COLOR=1,
// forcing picocolors to emit plain text in every environment (incl. CI, which
// would otherwise enable ANSI via the CI env var). So test assertions can use
// plain substrings and not worry about escape sequences.

function makeSummary(overrides: Partial<KnowledgeSummary> = {}): KnowledgeSummary {
  return {
    agent: "foo",
    sources: [],
    totals: {
      files: 0,
      bytes: 0,
      tokensInline: 0,
      tokensInlineBudget: 4000,
      hasInline: false,
    },
    ...overrides,
  };
}

describe("formatKnowledgeLines", () => {
  test("empty sources: returns empty array (caller suppresses display)", () => {
    expect(formatKnowledgeLines(makeSummary())).toEqual([]);
  });

  test("one changed file-delivery source: green arrow line + tally without token clause", () => {
    const lines = formatKnowledgeLines(
      makeSummary({
        sources: [{ id: "guide", delivery: "file", files: 15, bytes: 312 * 1024, changed: true }],
        totals: {
          files: 15,
          bytes: 312 * 1024,
          tokensInline: 0,
          tokensInlineBudget: 4000,
          hasInline: false,
        },
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("→ knowledge guide (15 files, 312.0KB, file)");
    expect(lines[0]).not.toContain("unchanged");
    expect(lines[1]).toContain("1 changed, 0 unchanged");
    expect(lines[1]).toContain("15 files, 312.0KB");
    expect(lines[1]).not.toContain("inline tokens");
  });

  test("one unchanged inline-delivery source: dim line + tally with token clause", () => {
    const lines = formatKnowledgeLines(
      makeSummary({
        sources: [{ id: "cheat", delivery: "inline", files: 1, bytes: 8 * 1024, changed: false }],
        totals: {
          files: 1,
          bytes: 8 * 1024,
          tokensInline: 980,
          tokensInlineBudget: 4000,
          hasInline: true,
        },
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("· knowledge cheat (1 file, 8.0KB, inline)");
    expect(lines[0]).toContain("(unchanged)");
    expect(lines[1]).toContain("0 changed, 1 unchanged");
    expect(lines[1]).toContain("1 file, 8.0KB");
    expect(lines[1]).toContain("inline tokens 980/4000");
  });

  test("mixed: per-source marks match per-source changed flag", () => {
    const lines = formatKnowledgeLines(
      makeSummary({
        sources: [
          { id: "guide", delivery: "file", files: 15, bytes: 312 * 1024, changed: true },
          { id: "cheat", delivery: "inline", files: 1, bytes: 8 * 1024, changed: false },
          { id: "changelog", delivery: "file", files: 1, bytes: 24 * 1024, changed: false },
        ],
        totals: {
          files: 17,
          bytes: 344 * 1024,
          tokensInline: 980,
          tokensInlineBudget: 4000,
          hasInline: true,
        },
      }),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("→ knowledge guide");
    expect(lines[1]).toContain("· knowledge cheat");
    expect(lines[1]).toContain("(unchanged)");
    expect(lines[2]).toContain("· knowledge changelog");
    expect(lines[2]).toContain("(unchanged)");
    expect(lines[3]).toContain("1 changed, 2 unchanged");
    expect(lines[3]).toContain("17 files, 344.0KB");
    expect(lines[3]).toContain("inline tokens 980/4000");
  });

  test("pluralization: 1 file singular, 2 files plural", () => {
    const lines = formatKnowledgeLines(
      makeSummary({
        sources: [{ id: "a", delivery: "file", files: 1, bytes: 100, changed: true }],
        totals: {
          files: 1,
          bytes: 100,
          tokensInline: 0,
          tokensInlineBudget: 4000,
          hasInline: false,
        },
      }),
    );
    expect(lines[0]).toContain("(1 file,");
    expect(lines[0]).not.toContain("(1 files,");
  });
});
