// tests/io/opencode-plugin.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  readOpencodePluginSentinel,
  registerAgentInOpencodePlugin,
  unregisterAgentFromOpencodePlugin,
} from "../../src/io/opencode-plugin";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "opencode-plugin-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("opencode-plugin", () => {
  test("first install writes plugin file + opencode.json entry + sentinel", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    const pluginTs = await readFile(join(dir, "plugins/agent-smith-refresh/index.ts"), "utf8");
    expect(pluginTs).toContain("smith knowledge refresh-session --platform opencode");
    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(cfg.plugin).toContain("./plugins/agent-smith-refresh");
    const sentinel = await readOpencodePluginSentinel(dir);
    expect(sentinel?.agents).toEqual(["agent-a"]);
  });

  test("second install appends to sentinel, doesn't duplicate plugin entry in opencode.json", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    await registerAgentInOpencodePlugin(dir, "agent-b");
    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(cfg.plugin.filter((p: string) => p === "./plugins/agent-smith-refresh")).toHaveLength(1);
    const sentinel = await readOpencodePluginSentinel(dir);
    expect(sentinel?.agents).toEqual(["agent-a", "agent-b"]);
  });

  test("preserves other plugin entries in opencode.json", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({ plugin: ["./plugins/other"], theme: "dark" }, null, 2),
      "utf8",
    );
    await registerAgentInOpencodePlugin(dir, "agent-a");
    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(cfg.plugin).toEqual(["./plugins/other", "./plugins/agent-smith-refresh"]);
    expect(cfg.theme).toBe("dark");
  });

  test("removing last agent deletes plugin dir + removes opencode.json entry", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    await unregisterAgentFromOpencodePlugin(dir, "agent-a");
    const sentinel = await readOpencodePluginSentinel(dir);
    expect(sentinel).toBeUndefined();
    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(cfg.plugin ?? []).not.toContain("./plugins/agent-smith-refresh");
  });

  test("removing one of many keeps the plugin in place", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    await registerAgentInOpencodePlugin(dir, "agent-b");
    await unregisterAgentFromOpencodePlugin(dir, "agent-a");
    const sentinel = await readOpencodePluginSentinel(dir);
    expect(sentinel?.agents).toEqual(["agent-b"]);
    const pluginExists = await Bun.file(join(dir, "plugins/agent-smith-refresh/index.ts")).exists();
    expect(pluginExists).toBe(true);
  });

  test("second install does not overwrite existing plugin index.ts", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    const pluginPath = join(dir, "plugins/agent-smith-refresh/index.ts");
    await writeFile(pluginPath, "TAMPERED", "utf8");
    await registerAgentInOpencodePlugin(dir, "agent-b");
    expect(await readFile(pluginPath, "utf8")).toBe("TAMPERED");
  });

  test("re-registering the same agent is a no-op for sentinel and opencode.json", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    await registerAgentInOpencodePlugin(dir, "agent-a");
    const sentinel = await readOpencodePluginSentinel(dir);
    expect(sentinel?.agents).toEqual(["agent-a"]);
    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(cfg.plugin.filter((p: string) => p === "./plugins/agent-smith-refresh")).toHaveLength(1);
  });

  test("installed_at is preserved across multi-agent appends", async () => {
    await registerAgentInOpencodePlugin(dir, "agent-a");
    const first = await readOpencodePluginSentinel(dir);
    const firstInstalledAt = first?.installed_at;
    expect(firstInstalledAt).toBeDefined();
    await new Promise((r) => setTimeout(r, 5));
    await registerAgentInOpencodePlugin(dir, "agent-b");
    const second = await readOpencodePluginSentinel(dir);
    expect(second?.installed_at).toBe(firstInstalledAt as string);
  });

  test("unregistering a never-registered agent on a virgin home is a no-op", async () => {
    await unregisterAgentFromOpencodePlugin(dir, "never-registered");
    const pluginExists = await Bun.file(join(dir, "plugins/agent-smith-refresh/index.ts")).exists();
    expect(pluginExists).toBe(false);
    const configExists = await Bun.file(join(dir, "opencode.json")).exists();
    expect(configExists).toBe(false);
  });

  describe("readConfig validation (via register/unregister)", () => {
    // Helper: write a raw string to opencode.json before the call.
    async function seedConfig(raw: string): Promise<void> {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "opencode.json"), raw, "utf8");
    }

    // Helper: assert the file contents are byte-for-byte unchanged.
    async function expectConfigUntouched(raw: string): Promise<void> {
      const after = await readFile(join(dir, "opencode.json"), "utf8");
      expect(after).toBe(raw);
    }

    test("register rejects opencode.json containing a JSON array", async () => {
      const raw = "[1,2,3]";
      await seedConfig(raw);
      let caught: unknown;
      try {
        await registerAgentInOpencodePlugin(dir, "agent-a");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      expect(payload.code).toBe("validation-failed");
      if (payload.code === "validation-failed") {
        expect(payload.what).toContain(join(dir, "opencode.json"));
        expect(payload.reasons.join(" ")).toMatch(/array/);
      }
      await expectConfigUntouched(raw);
    });

    test("register rejects opencode.json containing JSON null", async () => {
      const raw = "null";
      await seedConfig(raw);
      let caught: unknown;
      try {
        await registerAgentInOpencodePlugin(dir, "agent-a");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      expect(payload.code).toBe("validation-failed");
      if (payload.code === "validation-failed") {
        expect(payload.what).toContain(join(dir, "opencode.json"));
        expect(payload.reasons.join(" ")).toMatch(/null/);
      }
      await expectConfigUntouched(raw);
    });

    test("register rejects opencode.json containing a JSON string", async () => {
      const raw = '"foo"';
      await seedConfig(raw);
      await expect(registerAgentInOpencodePlugin(dir, "agent-a")).rejects.toBeInstanceOf(
        SmithError,
      );
      await expectConfigUntouched(raw);
    });

    test("register rejects opencode.json containing a JSON number", async () => {
      const raw = "42";
      await seedConfig(raw);
      await expect(registerAgentInOpencodePlugin(dir, "agent-a")).rejects.toBeInstanceOf(
        SmithError,
      );
      await expectConfigUntouched(raw);
    });

    test("register rejects opencode.json containing a JSON boolean", async () => {
      const raw = "true";
      await seedConfig(raw);
      await expect(registerAgentInOpencodePlugin(dir, "agent-a")).rejects.toBeInstanceOf(
        SmithError,
      );
      await expectConfigUntouched(raw);
    });

    test("register rejects opencode.json containing malformed JSON", async () => {
      const raw = "{not json";
      await seedConfig(raw);
      let caught: unknown;
      try {
        await registerAgentInOpencodePlugin(dir, "agent-a");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      expect(payload.code).toBe("validation-failed");
      if (payload.code === "validation-failed") {
        expect(payload.what).toContain(join(dir, "opencode.json"));
        expect(payload.reasons.join(" ")).toMatch(/malformed JSON/i);
      }
      await expectConfigUntouched(raw);
    });

    test("unregister also rejects a non-object opencode.json (teardown path)", async () => {
      // Set up the sentinel so unregister reaches the teardown branch that
      // calls readConfig().
      await registerAgentInOpencodePlugin(dir, "agent-a");
      // Now corrupt opencode.json to an array.
      const raw = "[1,2,3]";
      await writeFile(join(dir, "opencode.json"), raw, "utf8");
      let caught: unknown;
      try {
        await unregisterAgentFromOpencodePlugin(dir, "agent-a");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      expect(payload.code).toBe("validation-failed");
      await expectConfigUntouched(raw);
    });

    test("register preserves a non-empty existing object config", async () => {
      // Regression: ensure the new validation doesn't reject valid object configs.
      await seedConfig(JSON.stringify({ theme: "dark", model: "claude" }, null, 2));
      await registerAgentInOpencodePlugin(dir, "agent-a");
      const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
      expect(cfg.theme).toBe("dark");
      expect(cfg.model).toBe("claude");
      expect(cfg.plugin).toContain("./plugins/agent-smith-refresh");
    });
  });

  test("readOpencodePluginSentinel rejects a malformed sentinel file", async () => {
    const pluginPath = join(dir, "plugins/agent-smith-refresh");
    await mkdir(pluginPath, { recursive: true });
    await writeFile(
      join(pluginPath, ".smith-managed"),
      JSON.stringify({ agents: "not-an-array", installed_at: 42 }),
      "utf8",
    );
    await expect(readOpencodePluginSentinel(dir)).rejects.toThrow(/Malformed/);
  });
});
