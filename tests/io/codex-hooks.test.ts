import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCodexHooks,
  registerAgentInCodexHooks,
  removeAgentFromCodexHooks,
} from "../../src/io/codex-hooks";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "codex-hooks-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("codex-hooks", () => {
  test("creates a new hooks.json on first agent registration", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    const got = await readCodexHooks(dir);
    expect(got?._smith_managed.agents).toEqual(["agent-a"]);
    expect(got?.hooks.SessionStart[0]?.hooks[0]?.command).toContain(
      "smith knowledge refresh-session --platform codex",
    );
  });

  test("appends to existing smith-owned hooks.json", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    await registerAgentInCodexHooks(dir, "agent-b");
    const got = await readCodexHooks(dir);
    expect(got?._smith_managed.agents).toEqual(["agent-a", "agent-b"]);
  });

  test("idempotent: re-registering same agent doesn't duplicate", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    await registerAgentInCodexHooks(dir, "agent-a");
    const got = await readCodexHooks(dir);
    expect(got?._smith_managed.agents).toEqual(["agent-a"]);
  });

  test("refuses to overwrite non-smith hooks.json", async () => {
    const path = join(dir, "hooks.json");
    await writeFile(
      path,
      JSON.stringify({ hooks: { SessionStart: [] } }),
      "utf8",
    );
    await expect(
      registerAgentInCodexHooks(dir, "agent-a"),
    ).rejects.toThrow(/already exists and is not managed by smith/);
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after._smith_managed).toBeUndefined();
  });

  test("removing the last agent deletes hooks.json", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    await removeAgentFromCodexHooks(dir, "agent-a");
    const after = await readCodexHooks(dir);
    expect(after).toBeUndefined();
  });

  test("removing one of many leaves the file with the rest", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    await registerAgentInCodexHooks(dir, "agent-b");
    await removeAgentFromCodexHooks(dir, "agent-a");
    const after = await readCodexHooks(dir);
    expect(after?._smith_managed.agents).toEqual(["agent-b"]);
  });

  test("remove is a no-op when file doesn't exist", async () => {
    await expect(
      removeAgentFromCodexHooks(dir, "agent-a"),
    ).resolves.toBeUndefined();
  });

  test("remove is a no-op when agent isn't in the list", async () => {
    await registerAgentInCodexHooks(dir, "agent-a");
    await removeAgentFromCodexHooks(dir, "agent-b");
    const after = await readCodexHooks(dir);
    expect(after?._smith_managed.agents).toEqual(["agent-a"]);
  });
});
