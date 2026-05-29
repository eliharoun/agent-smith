import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../../src/core/types";
import { listAgentDirs } from "../../src/io/sources";

let tmp: string;
let source: Source;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-src-"));
  source = { kind: "user-global", rootPath: tmp, label: "test" };
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("io/sources", () => {
  test("returns empty list for empty source", async () => {
    const out = await listAgentDirs(source);
    expect(out).toEqual([]);
  });

  test("finds directories containing agent.config.json", async () => {
    await mkdir(join(tmp, "alpha"));
    await writeFile(join(tmp, "alpha", "agent.config.json"), "{}");
    await mkdir(join(tmp, "beta"));
    await writeFile(join(tmp, "beta", "agent.config.json"), "{}");
    await mkdir(join(tmp, "ignore-me"));
    const out = await listAgentDirs(source);
    expect(out.map((p) => p.split("/").pop()).sort()).toEqual(["alpha", "beta"]);
  });

  test("ignores subdirectories with no config", async () => {
    await mkdir(join(tmp, "not-an-agent"));
    await writeFile(join(tmp, "not-an-agent", "README.md"), "x");
    const out = await listAgentDirs(source);
    expect(out).toEqual([]);
  });

  test("non-existent source returns empty list (not error)", async () => {
    const ghost: Source = { kind: "user-global", rootPath: "/no/such/path", label: "ghost" };
    const out = await listAgentDirs(ghost);
    expect(out).toEqual([]);
  });

  test("single-bundle rootPath: returns rootPath itself if it contains agent.config.json", async () => {
    // Regression: C-series remote install clones a single-bundle git repo into
    // <remoteRoot>/<...>/<clone-dir>. The bundle files sit at the top of the
    // clone — agent.config.json is at <clone-dir>/agent.config.json. Before
    // this fix, listAgentDirs only walked subdirs and missed this layout, so
    // `agent install <name>` failed with 'not-found' after a successful clone.
    await writeFile(join(tmp, "agent.config.json"), "{}");
    const out = await listAgentDirs(source);
    expect(out).toEqual([tmp]);
  });

  test("single-bundle rootPath + sibling subdir bundles: both surface, no double-count", async () => {
    // If a registered source ever holds both (a) its own agent.config.json AND
    // (b) sub-bundles, both surface. The order does not matter; the set is
    // what callers consume.
    await writeFile(join(tmp, "agent.config.json"), "{}");
    await mkdir(join(tmp, "child"));
    await writeFile(join(tmp, "child", "agent.config.json"), "{}");
    const out = await listAgentDirs(source);
    expect(out.sort()).toEqual([tmp, join(tmp, "child")].sort());
  });
});
