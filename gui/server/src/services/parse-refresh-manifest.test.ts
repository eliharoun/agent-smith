import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRefreshConsent } from "./parse-refresh-manifest";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rc-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("loadRefreshConsent", () => {
  it("returns undefined when missing", async () => {
    expect(await loadRefreshConsent("x", home)).toBeUndefined();
  });

  it("loads a manifest", async () => {
    const dir = join(home, "agents", "x");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "refresh-manifest.json"),
      JSON.stringify({
        agent: "x",
        refresh_consent: {
          granted_at: "2026-01-01T00:00:00Z",
          platforms: ["opencode"],
          sources: ["s1"],
        },
      }),
    );
    const m = await loadRefreshConsent("x", home);
    expect(m?.refresh_consent.platforms).toEqual(["opencode"]);
  });
});
