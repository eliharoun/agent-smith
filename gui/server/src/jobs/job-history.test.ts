import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJobHistoryWriter,
  ENTRIES_KEEP_DAYS,
  OUTPUT_FILES_KEEP,
  readJobHistory,
  readJobOutput,
  sweepOldEntries,
} from "./job-history";

let dir: string;
let outputDir: string;
let jsonlPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jh-"));
  jsonlPath = join(dir, "gui-jobs.jsonl");
  outputDir = join(dir, "gui-jobs-output");
  await mkdir(outputDir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("module constants", () => {
  it("exports retention constants with sane defaults", () => {
    expect(OUTPUT_FILES_KEEP).toBe(50);
    expect(ENTRIES_KEEP_DAYS).toBe(30);
  });
});

describe("createJobHistoryWriter", () => {
  it("appends a JSONL line on finalize and writes the output log", async () => {
    const w = createJobHistoryWriter({ jsonlPath, outputDir });
    const sink = await w.beginJob("j1");
    sink.writeChunk("stdout chunk\n");
    sink.writeChunk("stderr chunk\n");
    await w.finalize({
      id: "j1",
      command: "doctor",
      argvPreview: "smith doctor",
      startedAt: 1000,
      endedAt: 2000,
      exitCode: 0,
    });
    const raw = await readFile(jsonlPath, "utf8");
    const obj = JSON.parse(raw.trim());
    expect(obj).toMatchObject({
      id: "j1",
      command: "doctor",
      durationMs: 1000,
      exitCode: 0,
      outputAvailable: true,
    });
    const log = await readFile(join(outputDir, "j1.log"), "utf8");
    expect(log).toContain("stdout chunk");
    expect(log).toContain("stderr chunk");
  });

  it("rotates output files beyond keepOutputs", async () => {
    const w = createJobHistoryWriter({ jsonlPath, outputDir, keepOutputs: 3 });
    for (let i = 0; i < 5; i++) {
      const id = `j${i}`;
      const sink = await w.beginJob(id);
      sink.writeChunk(`run ${i}\n`);
      await w.finalize({
        id,
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: i,
        endedAt: i + 1,
        exitCode: 0,
      });
    }
    const files = (await readdir(outputDir)).sort();
    expect(files).toEqual(["j2.log", "j3.log", "j4.log"]);
  });

  it("serializes concurrent appends (no interleaved JSON)", async () => {
    const w = createJobHistoryWriter({ jsonlPath, outputDir });
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const id = `c${i}`;
        const sink = await w.beginJob(id);
        sink.writeChunk("x");
        await w.finalize({
          id,
          command: "doctor",
          argvPreview: "smith doctor",
          startedAt: i,
          endedAt: i + 1,
          exitCode: 0,
        });
      }),
    );
    const raw = await readFile(jsonlPath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(20);
    for (const ln of lines) {
      expect(() => JSON.parse(ln)).not.toThrow();
    }
  });
});

describe("readJobHistory", () => {
  it("returns [] when file missing", async () => {
    expect(await readJobHistory({ jsonlPath })).toEqual([]);
  });

  it("tolerates a truncated last line", async () => {
    await writeFile(
      jsonlPath,
      `{"id":"a","command":"doctor","argvPreview":"smith doctor","startedAt":1,"endedAt":2,"exitCode":0,"durationMs":1,"outputAvailable":false}\n{"id":"b"`,
    );
    const out = await readJobHistory({ jsonlPath });
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe("a");
  });

  it("returns entries most-recent first", async () => {
    const w = createJobHistoryWriter({ jsonlPath, outputDir });
    for (const [i, id] of ["a", "b", "c"].entries()) {
      const sink = await w.beginJob(id);
      sink.writeChunk("x");
      await w.finalize({
        id,
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: i,
        endedAt: i + 1,
        exitCode: 0,
      });
    }
    const out = await readJobHistory({ jsonlPath });
    expect(out.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("respects limit and offset", async () => {
    const w = createJobHistoryWriter({ jsonlPath, outputDir });
    for (const [i, id] of ["a", "b", "c", "d", "e"].entries()) {
      const sink = await w.beginJob(id);
      sink.writeChunk("x");
      await w.finalize({
        id,
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: i,
        endedAt: i + 1,
        exitCode: 0,
      });
    }
    const out = await readJobHistory({ jsonlPath, limit: 2, offset: 1 });
    // Most-recent first: e, d, c, b, a; offset 1 limit 2 -> [d, c]
    expect(out.map((e) => e.id)).toEqual(["d", "c"]);
  });
});

describe("readJobOutput", () => {
  it("returns null when file missing", async () => {
    expect(await readJobOutput("nope", { outputDir })).toBeNull();
  });
  it("returns file contents", async () => {
    await writeFile(join(outputDir, "x.log"), "hello\n");
    expect(await readJobOutput("x", { outputDir })).toBe("hello\n");
  });
});

describe("sweepOldEntries", () => {
  it("drops entries older than ENTRIES_KEEP_DAYS", async () => {
    const now = Date.now();
    const old = now - (ENTRIES_KEEP_DAYS + 1) * 86_400_000;
    const fresh = now - 1000;
    const oldLine = JSON.stringify({
      id: "old",
      command: "doctor",
      argvPreview: "x",
      startedAt: old,
      endedAt: old + 1,
      exitCode: 0,
      durationMs: 1,
      outputAvailable: false,
    });
    const freshLine = JSON.stringify({
      id: "fresh",
      command: "doctor",
      argvPreview: "x",
      startedAt: fresh,
      endedAt: fresh + 1,
      exitCode: 0,
      durationMs: 1,
      outputAvailable: false,
    });
    await writeFile(jsonlPath, `${oldLine}\n${freshLine}\n`);
    await sweepOldEntries({ jsonlPath, now });
    const out = await readFile(jsonlPath, "utf8");
    expect(out).not.toContain('"id":"old"');
    expect(out).toContain('"id":"fresh"');
  });

  it("noop when jsonl file missing", async () => {
    await sweepOldEntries({ jsonlPath });
    // no throw
  });
});
