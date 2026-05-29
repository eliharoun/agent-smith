import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstalledSkills } from "./installed-skills";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "inst-skills-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadInstalledSkills", () => {
  it("returns [] on ENOENT", async () => {
    expect(await loadInstalledSkills({ path: join(dir, "x.json") })).toEqual([]);
  });

  it("parses a populated file", async () => {
    const path = join(dir, "installed-skills.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        installed: [
          {
            name: "a",
            sourceCatalogLabel: "L",
            sourcePath: "/p",
            installedPaths: { opencode: "/o" },
            contentHash: "h",
            installedAt: "t",
          },
        ],
      }),
    );
    const out = await loadInstalledSkills({ path });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("a");
  });

  it("returns [] on malformed JSON", async () => {
    const path = join(dir, "installed-skills.json");
    await writeFile(path, "garbage");
    expect(await loadInstalledSkills({ path })).toEqual([]);
  });
});
