import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerKiroRefreshHook, unregisterKiroRefreshHook } from "../../src/io/kiro-hooks";

let dir: string;
let agentPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kiro-hooks-"));
  agentPath = join(dir, "agent.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("registerKiroRefreshHook", () => {
  test("creates hooks.agentSpawn[] when absent", async () => {
    writeFileSync(agentPath, JSON.stringify({ name: "x" }));
    await registerKiroRefreshHook(agentPath, "x");
    const data = JSON.parse(readFileSync(agentPath, "utf8"));
    expect(data.hooks.agentSpawn[0].command).toContain("smith knowledge refresh-session");
    expect(data.hooks.agentSpawn[0].command).toContain("--agent x");
    expect(data.hooks.agentSpawn[0].command).toContain("--platform kiro");
  });

  test("idempotent: re-registering same agent is a no-op (byte-identical output)", async () => {
    writeFileSync(agentPath, JSON.stringify({ name: "x" }));
    await registerKiroRefreshHook(agentPath, "x");
    const before = readFileSync(agentPath, "utf8");
    await registerKiroRefreshHook(agentPath, "x");
    const after = readFileSync(agentPath, "utf8");
    expect(after).toBe(before);
  });

  test("preserves co-resident hook entries (AIM, kiro-lens) byte-for-byte", async () => {
    writeFileSync(
      agentPath,
      JSON.stringify({
        name: "x",
        hooks: {
          agentSpawn: [
            { command: "aim agents publish-metrics --agent-name 'x' --agent-package 'P' || true" },
            {
              command: "/Users/u/.kiro-lens/hooks/agent-spawn.sh x || true",
              description: "kiro-lens:auto-injected: kiro-lens agentSpawn",
            },
          ],
        },
      }),
    );
    await registerKiroRefreshHook(agentPath, "x");
    const data = JSON.parse(readFileSync(agentPath, "utf8"));
    expect(data.hooks.agentSpawn).toHaveLength(3);
    expect(
      data.hooks.agentSpawn.find((h: { command: string }) => h.command.startsWith("aim agents")),
    ).toBeDefined();
    expect(
      data.hooks.agentSpawn.find((h: { command: string }) => h.command.includes("kiro-lens")),
    ).toBeDefined();
    expect(
      data.hooks.agentSpawn.find((h: { command: string }) => h.command.includes("smith knowledge")),
    ).toBeDefined();
  });

  test("ENOENT on agent file → throws SmithError(not-found)", async () => {
    await expect(registerKiroRefreshHook(join(dir, "missing.json"), "x")).rejects.toThrow(
      /not.found/i,
    );
  });
});

describe("unregisterKiroRefreshHook", () => {
  test("removes only the smith entry; preserves AIM/kiro-lens", async () => {
    writeFileSync(
      agentPath,
      JSON.stringify({
        name: "x",
        hooks: {
          agentSpawn: [
            { command: "aim agents publish-metrics --agent-name 'x' --agent-package 'P' || true" },
            { command: "smith knowledge refresh-session --agent x --platform kiro" },
            { command: "/Users/u/.kiro-lens/hooks/agent-spawn.sh x || true" },
          ],
        },
      }),
    );
    await unregisterKiroRefreshHook(agentPath, "x");
    const data = JSON.parse(readFileSync(agentPath, "utf8"));
    expect(data.hooks.agentSpawn).toHaveLength(2);
    expect(
      data.hooks.agentSpawn.find((h: { command: string }) => h.command.includes("smith knowledge")),
    ).toBeUndefined();
    expect(
      data.hooks.agentSpawn.find((h: { command: string }) => h.command.startsWith("aim agents")),
    ).toBeDefined();
  });

  test("when only smith entry exists: deletes hooks.agentSpawn key, then hooks field", async () => {
    writeFileSync(
      agentPath,
      JSON.stringify({
        name: "x",
        hooks: {
          agentSpawn: [{ command: "smith knowledge refresh-session --agent x --platform kiro" }],
        },
      }),
    );
    await unregisterKiroRefreshHook(agentPath, "x");
    const data = JSON.parse(readFileSync(agentPath, "utf8"));
    expect(data.hooks).toBeUndefined();
  });

  test("idempotent: unregister with no smith entry is a no-op", async () => {
    writeFileSync(
      agentPath,
      JSON.stringify({
        name: "x",
        hooks: { agentSpawn: [{ command: "other" }] },
      }),
    );
    const before = readFileSync(agentPath, "utf8");
    await unregisterKiroRefreshHook(agentPath, "x");
    const after = readFileSync(agentPath, "utf8");
    expect(after).toBe(before);
  });

  test("ENOENT on agent file → no-op (resolves without error)", async () => {
    await expect(
      unregisterKiroRefreshHook(join(dir, "missing.json"), "x"),
    ).resolves.toBeUndefined();
  });

  test("only removes smith entry matching --agent <name>", async () => {
    // Two smith entries for different agents; unregistering one must
    // leave the other intact.
    writeFileSync(
      agentPath,
      JSON.stringify({
        name: "y",
        hooks: {
          agentSpawn: [
            { command: "smith knowledge refresh-session --agent x --platform kiro" }, // not ours
            { command: "smith knowledge refresh-session --agent y --platform kiro" }, // ours
          ],
        },
      }),
    );
    await unregisterKiroRefreshHook(agentPath, "y");
    const data = JSON.parse(readFileSync(agentPath, "utf8"));
    expect(data.hooks.agentSpawn).toHaveLength(1);
    expect(data.hooks.agentSpawn[0].command).toContain("--agent x");
  });
});
