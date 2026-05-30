import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateCodexHooks } from "../../src/cli/commands/knowledge/migrate-codex";
import { SmithError } from "../../src/core/smith-error";

/**
 * Tests for `smith knowledge migrate-codex` helper.
 *
 * Covers the upgrade path for pre-0.15 users who hand-wrote
 * `~/.codex/hooks.json` to invoke `smith knowledge refresh-session`
 * before Phase-4 introduced smith-managed ownership of that file.
 *
 * Asserts on the pure helper `migrateCodexHooks(path)` — the CLI verb
 * is a thin print + exit-code shim and is exercised indirectly via the
 * established `wrap()` plumbing.
 */

const SMITH_CMD = "smith knowledge refresh-session --platform codex";

let dir: string;
let hooksPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "migrate-codex-"));
  hooksPath = join(dir, "hooks.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function smithEntry(matcher = "startup|resume") {
  return {
    matcher,
    hooks: [{ type: "command", command: SMITH_CMD, timeout: 5 }],
  };
}

describe("migrateCodexHooks", () => {
  test("missing file -> noop", async () => {
    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("noop");
  });

  test("already-managed file -> noop, untouched", async () => {
    const managed = {
      hooks: { SessionStart: [smithEntry()] },
      _smith_managed: { agents: ["foo"], installed_at: "2024-01-01T00:00:00.000Z" },
    };
    const text = `${JSON.stringify(managed, null, 2)}\n`;
    await writeFile(hooksPath, text, "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("noop");
    if (result.action === "noop") {
      expect(result.reason).toMatch(/already managed/i);
    }

    const after = await readFile(hooksPath, "utf8");
    expect(after).toBe(text);
  });

  test("empty/missing hooks field -> noop with specific reason", async () => {
    await writeFile(hooksPath, JSON.stringify({ hooks: {} }, null, 2), "utf8");
    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("noop");
    if (result.action === "noop") {
      expect(result.reason).toBe("no smith hooks to claim");
    }
  });

  test("only smith-compatible commands across multiple events -> claimed", async () => {
    const input = {
      hooks: {
        SessionStart: [
          smithEntry("startup|resume"),
          {
            matcher: "other",
            hooks: [{ type: "command", command: "  smith   knowledge  refresh-session  --platform codex  " }],
          },
        ],
        SomeOtherEvent: [
          { matcher: "*", hooks: [{ type: "command", command: SMITH_CMD }] },
        ],
      },
      $schema: "https://example.com/codex-hooks.schema.json",
    };
    await writeFile(hooksPath, JSON.stringify(input, null, 2), "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("claimed");

    const after = JSON.parse(await readFile(hooksPath, "utf8"));
    // Sentinel present with empty agents and ISO installed_at.
    expect(after._smith_managed).toBeDefined();
    expect(after._smith_managed.agents).toEqual([]);
    expect(typeof after._smith_managed.installed_at).toBe("string");
    expect(() => new Date(after._smith_managed.installed_at).toISOString()).not.toThrow();
    // Original hooks tree preserved verbatim.
    expect(after.hooks).toEqual(input.hooks);
    // Unrelated top-level keys preserved.
    expect(after.$schema).toBe(input.$schema);
  });

  test("any unrelated command -> conflict, file untouched", async () => {
    const input = {
      hooks: {
        SessionStart: [
          smithEntry(),
          {
            matcher: "startup",
            hooks: [
              { type: "command", command: "echo hi" },
              { type: "command", command: SMITH_CMD },
            ],
          },
        ],
        UserPromptSubmit: [
          { matcher: "*", hooks: [{ type: "command", command: "my-custom-thing --flag" }] },
        ],
      },
    };
    const text = `${JSON.stringify(input, null, 2)}\n`;
    await writeFile(hooksPath, text, "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("conflict");
    if (result.action === "conflict") {
      const cmds = result.unrelated.map((u) => u.command);
      expect(cmds).toContain("echo hi");
      expect(cmds).toContain("my-custom-thing --flag");
      expect(cmds).not.toContain(SMITH_CMD);
      // Event label is attached to each entry.
      const echoEntry = result.unrelated.find((u) => u.command === "echo hi");
      expect(echoEntry?.event).toBe("SessionStart");
      expect(echoEntry?.matcher).toBe("startup");
      const customEntry = result.unrelated.find((u) => u.command === "my-custom-thing --flag");
      expect(customEntry?.event).toBe("UserPromptSubmit");
      expect(customEntry?.matcher).toBe("*");
    }

    const after = await readFile(hooksPath, "utf8");
    expect(after).toBe(text);
  });

  test("hooks[event] is a string (not array) -> conflict, malformed value surfaced", async () => {
    const input = {
      hooks: {
        SessionStart: "smith knowledge refresh-session",
      },
    };
    const text = `${JSON.stringify(input, null, 2)}\n`;
    await writeFile(hooksPath, text, "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("conflict");
    if (result.action === "conflict") {
      expect(result.unrelated.length).toBeGreaterThan(0);
      const entry = result.unrelated.find((u) => u.event === "SessionStart");
      expect(entry).toBeDefined();
      // Malformed payload surfaced in command field so the user can locate it.
      expect(entry?.command).toContain("smith knowledge refresh-session");
      // No matcher available on this shape.
      expect(entry?.matcher).toBeUndefined();
    }

    // File untouched.
    const after = await readFile(hooksPath, "utf8");
    expect(after).toBe(text);
  });

  test("EntryGroup missing 'hooks' array (inner hooks non-array) -> conflict", async () => {
    const input = {
      hooks: {
        SessionStart: [{ matcher: "startup", hooks: "not-an-array" }],
      },
    };
    const text = `${JSON.stringify(input, null, 2)}\n`;
    await writeFile(hooksPath, text, "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("conflict");
    if (result.action === "conflict") {
      const entry = result.unrelated.find((u) => u.event === "SessionStart");
      expect(entry).toBeDefined();
      expect(entry?.matcher).toBe("startup");
      expect(entry?.command).toContain("not-an-array");
    }

    const after = await readFile(hooksPath, "utf8");
    expect(after).toBe(text);
  });

  test("inner hook missing 'command' field -> conflict with synthetic representation", async () => {
    const input = {
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command" }] },
        ],
      },
    };
    const text = `${JSON.stringify(input, null, 2)}\n`;
    await writeFile(hooksPath, text, "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("conflict");
    if (result.action === "conflict") {
      const entry = result.unrelated.find((u) => u.event === "SessionStart");
      expect(entry).toBeDefined();
      expect(entry?.matcher).toBe("startup");
      // Synthetic representation — undefined serializes via JSON.stringify
      // to undefined, so we expect a non-empty placeholder string.
      expect(typeof entry?.command).toBe("string");
    }

    const after = await readFile(hooksPath, "utf8");
    expect(after).toBe(text);
  });

  test("conflict tuple includes matcher when EntryGroup has one", async () => {
    const input = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "echo first" }],
          },
          {
            matcher: "resume",
            hooks: [{ type: "command", command: "echo second" }],
          },
        ],
      },
    };
    await writeFile(hooksPath, JSON.stringify(input, null, 2), "utf8");

    const result = await migrateCodexHooks(hooksPath);
    expect(result.action).toBe("conflict");
    if (result.action === "conflict") {
      const first = result.unrelated.find((u) => u.command === "echo first");
      const second = result.unrelated.find((u) => u.command === "echo second");
      expect(first?.matcher).toBe("startup");
      expect(second?.matcher).toBe("resume");
    }
  });

  test("malformed JSON -> SmithError validation-failed", async () => {
    await writeFile(hooksPath, "{ not json", "utf8");
    let caught: unknown;
    try {
      await migrateCodexHooks(hooksPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    if (caught instanceof SmithError) {
      expect(caught.payload.code).toBe("validation-failed");
    }
  });
});
