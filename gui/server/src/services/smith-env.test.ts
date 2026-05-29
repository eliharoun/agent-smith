import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSmithEnv, writeSmithEnv } from "./smith-env";

let dir: string;
let envPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-env-"));
  envPath = join(dir, ".env");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readSmithEnv", () => {
  it("returns empty on missing file", async () => {
    expect(await readSmithEnv({ envPath })).toEqual({});
  });
  it("parses configured ints", async () => {
    await writeFile(envPath, "SMITH_PULL_INTERVAL_MS=60000\nSMITH_HEARTBEAT_INTERVAL_MS=3000\n");
    expect(await readSmithEnv({ envPath })).toEqual({
      pullIntervalMs: 60000,
      heartbeatIntervalMs: 3000,
    });
  });
  it("omits invalid (non-positive) values", async () => {
    await writeFile(envPath, "SMITH_PULL_INTERVAL_MS=0\nSMITH_HEARTBEAT_INTERVAL_MS=abc\n");
    expect(await readSmithEnv({ envPath })).toEqual({});
  });
  it("ignores unrelated keys", async () => {
    await writeFile(envPath, "OTHER=x\nSMITH_PULL_INTERVAL_MS=1000\n");
    expect(await readSmithEnv({ envPath })).toEqual({ pullIntervalMs: 1000 });
  });
});

describe("writeSmithEnv", () => {
  it("creates the file with 0600 and the requested keys", async () => {
    await writeSmithEnv({ pullIntervalMs: 60000 }, { envPath });
    const raw = await readFile(envPath, "utf8");
    expect(raw).toContain("SMITH_PULL_INTERVAL_MS=60000");
    const s = await stat(envPath);
    expect(s.mode & 0o777).toBe(0o600);
  });
  it("preserves unrelated keys and comments", async () => {
    await writeFile(envPath, "# top\nOTHER=keep\nSMITH_PULL_INTERVAL_MS=1\n");
    await writeSmithEnv({ pullIntervalMs: 2 }, { envPath });
    const raw = await readFile(envPath, "utf8");
    expect(raw).toContain("# top");
    expect(raw).toContain("OTHER=keep");
    expect(raw).toContain("SMITH_PULL_INTERVAL_MS=2");
  });
  it("removes a key when given undefined (with explicit property)", async () => {
    await writeFile(envPath, "SMITH_PULL_INTERVAL_MS=1\nSMITH_HEARTBEAT_INTERVAL_MS=2\n");
    await writeSmithEnv({ pullIntervalMs: undefined }, { envPath });
    const raw = await readFile(envPath, "utf8");
    expect(raw).not.toMatch(/^SMITH_PULL_INTERVAL_MS=/m);
    expect(raw).toContain("SMITH_HEARTBEAT_INTERVAL_MS=2");
  });
  it("leaves a key untouched when the property is absent", async () => {
    await writeFile(envPath, "SMITH_PULL_INTERVAL_MS=1\nSMITH_HEARTBEAT_INTERVAL_MS=2\n");
    await writeSmithEnv({ heartbeatIntervalMs: 7 }, { envPath });
    const raw = await readFile(envPath, "utf8");
    expect(raw).toContain("SMITH_PULL_INTERVAL_MS=1");
    expect(raw).toContain("SMITH_HEARTBEAT_INTERVAL_MS=7");
  });
});
