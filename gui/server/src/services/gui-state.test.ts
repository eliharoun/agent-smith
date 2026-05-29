import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGuiState, saveGuiState } from "./gui-state";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gui-state-"));
  file = join(dir, "gui-state.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("gui-state service", () => {
  it("returns defaults when file is missing", async () => {
    const state = await loadGuiState({ path: file, currentVersion: "0.22.0" });
    expect(state.schemaVersion).toBe(1);
    expect(state.mode).toBe("guided");
    expect(state.theme.intensity).toBe("medium");
    expect(state.port).toBe(7777);
  });

  it("self-heals on malformed JSON", async () => {
    await writeFile(file, "{ not json", "utf8");
    const state = await loadGuiState({ path: file, currentVersion: "0.22.0" });
    expect(state.schemaVersion).toBe(1);
  });

  it("self-heals on schema mismatch", async () => {
    await writeFile(file, JSON.stringify({ mode: "invalid" }), "utf8");
    const state = await loadGuiState({ path: file, currentVersion: "0.22.0" });
    expect(state.mode).toBe("guided");
  });

  it("round-trips a saved patch", async () => {
    await saveGuiState({
      path: file,
      currentVersion: "0.22.0",
      patch: { mode: "expert", tourCompleted: true },
    });
    const state = await loadGuiState({ path: file, currentVersion: "0.22.0" });
    expect(state.mode).toBe("expert");
    expect(state.tourCompleted).toBe(true);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(raw.schemaVersion).toBe(1);
  });
});
