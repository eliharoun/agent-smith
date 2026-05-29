import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConventions, saveConventions } from "../../src/io/conventions";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "smith-conv-"));
});
afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

describe("loadConventions", () => {
  test("ENOENT → empty file", async () => {
    const file = await loadConventions({ homeDir });
    expect(file).toEqual({ schemaVersion: 1, platformConventions: {} });
  });

  test("returns parsed file when present", async () => {
    await saveConventions(
      {
        schemaVersion: 1,
        platformConventions: {
          kiro: { default: "accept-all", explicit: ["workspace-steering"] },
        },
      },
      { homeDir },
    );
    const file = await loadConventions({ homeDir });
    expect(file.platformConventions.kiro?.default).toBe("accept-all");
    expect(file.platformConventions.kiro?.explicit).toEqual(["workspace-steering"]);
  });

  test("malformed shape → empty file (does not crash)", async () => {
    // Lenient posture: a corrupted manifest doesn't block installs.
    const path = join(homeDir, ".config/agent-smith/conventions.json");
    await Bun.write(path, '{"not": "valid"}');
    const file = await loadConventions({ homeDir });
    expect(file).toEqual({ schemaVersion: 1, platformConventions: {} });
  });
});

describe("saveConventions", () => {
  test("writes atomically to ~/.config/agent-smith/conventions.json", async () => {
    await saveConventions(
      { schemaVersion: 1, platformConventions: { kiro: { default: "prompt" } } },
      { homeDir },
    );
    const path = join(homeDir, ".config/agent-smith/conventions.json");
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw).platformConventions.kiro.default).toBe("prompt");
  });
});
