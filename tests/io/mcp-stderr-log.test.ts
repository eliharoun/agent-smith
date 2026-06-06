import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMcpStderrLog } from "../../src/io/mcp-stderr-log";

let logDir: string;
beforeEach(async () => {
  logDir = await mkdtemp(join(tmpdir(), "mcp-log-"));
});
afterEach(async () => {
  await rm(logDir, { recursive: true, force: true });
});

describe("openMcpStderrLog", () => {
  it("creates the log file under <logDir>/<server>.log and writes data", async () => {
    const log = await openMcpStderrLog({ logDir, serverName: "slack-mcp" });
    log.write(Buffer.from("hello\n"));
    log.write(Buffer.from("world\n"));
    await log.close();
    const contents = await readFile(join(logDir, "slack-mcp.log"), "utf8");
    expect(contents).toBe("hello\nworld\n");
  });

  it("appends to existing log on subsequent opens", async () => {
    const log1 = await openMcpStderrLog({ logDir, serverName: "x" });
    log1.write(Buffer.from("first\n"));
    await log1.close();
    const log2 = await openMcpStderrLog({ logDir, serverName: "x" });
    log2.write(Buffer.from("second\n"));
    await log2.close();
    const contents = await readFile(join(logDir, "x.log"), "utf8");
    expect(contents).toBe("first\nsecond\n");
  });

  it("rotates when file exceeds maxBytes", async () => {
    const path = join(logDir, "rot.log");
    await writeFile(path, Buffer.alloc(11 * 1024 * 1024, "a"));
    const log = await openMcpStderrLog({ logDir, serverName: "rot" });
    log.write(Buffer.from("trigger rotation\n"));
    await log.close();
    const main = await stat(path);
    expect(main.size).toBeLessThan(1000);
    const rotated = await stat(join(logDir, "rot.log.1"));
    expect(rotated.size).toBeGreaterThan(10 * 1024 * 1024);
  });

  it("sanitizes server names (drops path-traversal characters)", async () => {
    const log = await openMcpStderrLog({ logDir, serverName: "../escape/attempt" });
    log.write(Buffer.from("x"));
    await log.close();
    const expectedPath = join(logDir, "..__escape_attempt.log");
    expect((await stat(expectedPath)).isFile()).toBe(true);
  });

  it("survives log-open failure: write/close are no-ops", async () => {
    const badDir = "/dev/null/cannot-create";
    const log = await openMcpStderrLog({ logDir: badDir, serverName: "y" });
    expect(() => log.write(Buffer.from("dropped"))).not.toThrow();
    await log.close();
  });

  it("caps server name at 64 chars", async () => {
    const longName = "a".repeat(200);
    const log = await openMcpStderrLog({ logDir, serverName: longName });
    log.write(Buffer.from("x"));
    await log.close();
    const stats = await stat(join(logDir, `${"a".repeat(64)}.log`));
    expect(stats.isFile()).toBe(true);
  });
});
