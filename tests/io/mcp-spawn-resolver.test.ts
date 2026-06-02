import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpawnOptsResolver } from "../../src/io/mcp-spawn-resolver";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "spawn-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("createSpawnOptsResolver", () => {
  it("returns spawn opts for an installed server", async () => {
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { echo: { command: "bun", args: ["echo.ts"] } },
      }),
    );
    const resolve = await createSpawnOptsResolver({ homeDir: home });
    const opts = resolve("echo");
    expect(opts.command).toBe("bun");
    expect(opts.args).toEqual(["echo.ts"]);
  });

  it("throws SmithError when server is not configured", async () => {
    const resolve = await createSpawnOptsResolver({ homeDir: home });
    expect(() => resolve("missing")).toThrow(/missing/);
  });
});
