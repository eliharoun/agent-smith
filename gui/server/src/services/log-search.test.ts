import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchLogs } from "./log-search";

let outputDir: string;
beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "ls-"));
});
afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("searchLogs (JS fallback)", () => {
  it("returns empty array when query has no matches", async () => {
    await writeFile(join(outputDir, "a.log"), "nothing here\n");
    const hits = await searchLogs("missing", { outputDir, useRipgrep: false });
    expect(hits).toEqual([]);
  });

  it("returns hits with line numbers and context", async () => {
    const content = ["alpha", "ERROR: bad", "gamma", "delta"].join("\n") + "\n";
    await writeFile(join(outputDir, "j1.log"), content);
    const hits = await searchLogs("ERROR", { outputDir, useRipgrep: false });
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({
      jobId: "j1",
      lineNumber: 2,
      matchedLine: "ERROR: bad",
      contextBefore: ["alpha"],
      contextAfter: ["gamma"],
    });
  });

  it("scans multiple files", async () => {
    await writeFile(join(outputDir, "a.log"), "match\n");
    await writeFile(join(outputDir, "b.log"), "no\nmatch\n");
    const hits = await searchLogs("match", { outputDir, useRipgrep: false });
    expect(hits.length).toBe(2);
    expect(new Set(hits.map((h) => h.jobId))).toEqual(new Set(["a", "b"]));
  });

  it("respects limit", async () => {
    let body = "";
    for (let i = 0; i < 10; i++) body += `match ${i}\n`;
    await writeFile(join(outputDir, "z.log"), body);
    const hits = await searchLogs("match", { outputDir, useRipgrep: false, limit: 3 });
    expect(hits.length).toBe(3);
  });

  it("returns empty when outputDir missing", async () => {
    await rm(outputDir, { recursive: true, force: true });
    const hits = await searchLogs("x", { outputDir, useRipgrep: false });
    expect(hits).toEqual([]);
  });

  it("returns empty for empty query", async () => {
    await writeFile(join(outputDir, "a.log"), "match\n");
    const hits = await searchLogs("", { outputDir, useRipgrep: false });
    expect(hits).toEqual([]);
  });
});
