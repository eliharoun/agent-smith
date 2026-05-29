import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTailBroker } from "./file-tail-broker";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ft-"));
  path = join(dir, "log.txt");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileTailBroker.subscribe", () => {
  it("returns empty initial + watches for creation when file missing", async () => {
    const broker = new FileTailBroker();
    const sub = broker.subscribe(path, { initialLines: 10 });
    // Wait briefly so initial-read settles before we inspect it.
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.initial).toEqual([]);
    // Create file with one line; reader should emit it.
    await writeFile(path, "first line\n");
    const iter = sub.stream[Symbol.asyncIterator]();
    const next = (await Promise.race([
      iter.next(),
      new Promise((r) => setTimeout(() => r({ value: null, done: true }), 1500)),
    ])) as IteratorResult<string>;
    expect(next.value).toBe("first line");
    sub.close();
  });

  it("returns last N lines on subscribe to existing file", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\n";
    await writeFile(path, lines);
    const broker = new FileTailBroker();
    const sub = broker.subscribe(path, { initialLines: 5 });
    // Initial read is async — wait a tick.
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.initial.length).toBe(5);
    expect(sub.initial[4]).toBe("line 49");
    sub.close();
  });

  it("streams appended lines", async () => {
    await writeFile(path, "head\n");
    const broker = new FileTailBroker();
    const sub = broker.subscribe(path, { initialLines: 10 });
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.initial).toEqual(["head"]);
    const got: string[] = [];
    const reader = (async () => {
      for await (const line of sub.stream) {
        got.push(line);
        if (got.length === 2) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 30));
    await appendFile(path, "two\nthree\n");
    await reader;
    expect(got).toEqual(["two", "three"]);
    sub.close();
  });

  it("resets to BOF on rotation (size shrinks)", async () => {
    await writeFile(path, "old1\nold2\n");
    const broker = new FileTailBroker();
    const sub = broker.subscribe(path, { initialLines: 10 });
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.initial).toEqual(["old1", "old2"]);
    const got: string[] = [];
    const reader = (async () => {
      for await (const line of sub.stream) {
        got.push(line);
        if (got.length === 1) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 30));
    // Truncate + write fresh content.
    await writeFile(path, "fresh\n");
    await reader;
    expect(got).toEqual(["fresh"]);
    sub.close();
  });
});
