import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBundle } from "./scan-bundle";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bundle-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeBundle(name: string) {
  const bundle = join(dir, name);
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, "IDENTITY.md"), "# Identity\nI am foo.\n");
  await writeFile(join(bundle, "EXPERTISE.md"), "# Expertise\nThings.\n");
  await writeFile(join(bundle, "SOUL.md"), "# Soul\nVibes.\n");
  await writeFile(join(bundle, "USER.md"), "# User\nYou.\n");
  await writeFile(
    join(bundle, "agent.config.json"),
    JSON.stringify({
      name,
      description: "test agent",
      model: "sonnet",
      targets: ["opencode"],
    }),
  );
  return bundle;
}

describe("scanBundle", () => {
  it("reads all five files into AgentDetail", async () => {
    const path = await writeBundle("foo");
    const detail = await scanBundle({ name: "foo", catalog: "test", path });
    expect(detail.name).toBe("foo");
    expect(detail.identity).toContain("I am foo");
    expect(detail.soul).toContain("Vibes");
    expect(detail.targets).toEqual(["opencode"]);
    expect(detail.model).toBe("sonnet");
  });

  it("throws a typed error when a required file is missing", async () => {
    const path = join(dir, "broken");
    await mkdir(path, { recursive: true });
    await expect(scanBundle({ name: "broken", catalog: "test", path })).rejects.toThrow(/missing/);
  });

  it("throws with bundle path context when agent.config.json is malformed JSON", async () => {
    const path = await writeBundle("bad");
    await writeFile(join(path, "agent.config.json"), "{ not json");
    await expect(scanBundle({ name: "bad", catalog: "test", path })).rejects.toThrow(
      /invalid JSON in .*agent\.config\.json/,
    );
  });

  it("throws with bundle path context when agent.config.json fails schema", async () => {
    const path = await writeBundle("bad");
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({ name: 123, targets: ["nope"] }),
    );
    await expect(scanBundle({ name: "bad", catalog: "test", path })).rejects.toThrow(
      /invalid agent\.config\.json in/,
    );
  });

  it("falls back to modelTier when model is not set", async () => {
    const path = await writeBundle("with-tier");
    // Real-world bundles ship modelTier (canonical CLI schema), not model.
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({
        name: "with-tier",
        description: "test agent",
        modelTier: "opus",
        targets: ["opencode"],
      }),
    );
    const detail = await scanBundle({ name: "with-tier", catalog: "test", path });
    expect(detail.model).toBe("opus");
  });

  it("prefers explicit model over modelTier when both are set", async () => {
    const path = await writeBundle("override");
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({
        name: "override",
        description: "test agent",
        model: "claude-3-5-sonnet-20241022",
        modelTier: "sonnet",
        targets: ["opencode"],
      }),
    );
    const detail = await scanBundle({ name: "override", catalog: "test", path });
    expect(detail.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("rejects an empty IDENTITY.md as corruption", async () => {
    const path = await writeBundle("empty-identity");
    await writeFile(join(path, "IDENTITY.md"), "");
    await expect(scanBundle({ name: "empty-identity", catalog: "test", path })).rejects.toThrow(
      /empty required bundle file.*IDENTITY\.md/,
    );
  });

  it("rejects a whitespace-only SOUL.md as corruption", async () => {
    const path = await writeBundle("empty-soul");
    await writeFile(join(path, "SOUL.md"), "   \n\t\n");
    await expect(scanBundle({ name: "empty-soul", catalog: "test", path })).rejects.toThrow(
      /empty required bundle file.*SOUL\.md/,
    );
  });

  it("reports every missing file in a single aggregated error", async () => {
    const path = join(dir, "many-missing");
    await mkdir(path, { recursive: true });
    // Only write SOUL.md and USER.md and agent.config.json — IDENTITY/EXPERTISE missing.
    await writeFile(join(path, "SOUL.md"), "# Soul\nVibes.\n");
    await writeFile(join(path, "USER.md"), "# User\nYou.\n");
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({ name: "many-missing", targets: ["opencode"] }),
    );
    let caught: Error | undefined;
    try {
      await scanBundle({ name: "many-missing", catalog: "test", path });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const message = caught?.message ?? "";
    expect(message).toContain("IDENTITY.md");
    expect(message).toContain("EXPERTISE.md");
  });

  it("rejects unknown Platform values in targets via zod", async () => {
    const path = await writeBundle("bad-target");
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({
        name: "bad-target",
        description: "test agent",
        targets: ["windows"],
      }),
    );
    await expect(scanBundle({ name: "bad-target", catalog: "test", path })).rejects.toThrow(
      /invalid agent\.config\.json/,
    );
  });

  it("rejects agent.config.json with missing name field", async () => {
    const path = await writeBundle("no-name");
    await writeFile(
      join(path, "agent.config.json"),
      JSON.stringify({ description: "no name here", targets: ["opencode"] }),
    );
    await expect(scanBundle({ name: "no-name", catalog: "test", path })).rejects.toThrow(
      /invalid agent\.config\.json/,
    );
  });

  it("errors clearly when bundle path is a regular file rather than a directory", async () => {
    const path = join(dir, "not-a-dir");
    await writeFile(path, "I am a file, not a bundle directory");
    // readFile on `<file>/IDENTITY.md` yields ENOTDIR; current readRequired only
    // remaps ENOENT, so the raw errno bubbles. Assert on a stable substring of
    // the path so the test documents the observed behavior.
    await expect(scanBundle({ name: "not-a-dir", catalog: "test", path })).rejects.toThrow(
      /not-a-dir/,
    );
  });
});
