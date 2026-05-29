import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../../src/core/types";
import { type Registry, resolveAllSources, SELF_SOURCE_LABEL } from "../../src/io/registry";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-self-source-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const reg = (sources: Source[]): Registry => ({ schemaVersion: 2, sources });

describe("resolveAllSources", () => {
  test("appends synthetic self-source when not already registered", async () => {
    const r = reg([{ kind: "user-global", rootPath: "/u", label: "u" }]);
    const self: Source = {
      kind: "registered",
      rootPath: join(tmp, "agents"),
      label: SELF_SOURCE_LABEL,
    };
    const out = await resolveAllSources(r, { resolveSelf: async () => self });
    expect(out).toEqual([...r.sources, self]);
    expect(out[out.length - 1]).toEqual(self);
  });

  test("skips synthetic when already registered (resolve()-normalized match)", async () => {
    const agentsDir = join(tmp, "agents");
    // Registered with a trailing slash; synthetic without. resolve() must
    // normalize both sides so the dedup catches the collision.
    const r = reg([
      { kind: "registered", rootPath: `${agentsDir}/`, label: "manual" },
    ]);
    const self: Source = {
      kind: "registered",
      rootPath: agentsDir,
      label: SELF_SOURCE_LABEL,
    };
    const out = await resolveAllSources(r, { resolveSelf: async () => self });
    expect(out).toEqual(r.sources);
    expect(out.some((s) => s.label === SELF_SOURCE_LABEL)).toBe(false);
  });

  test("returns registry.sources unchanged when self resolves to null", async () => {
    const r = reg([{ kind: "user-global", rootPath: "/u", label: "u" }]);
    const out = await resolveAllSources(r, { resolveSelf: async () => null });
    expect(out).toEqual(r.sources);
  });

  test("gitRemote is populated on the synthetic source when injected resolver provides one", async () => {
    const r = reg([]);
    const self: Source = {
      kind: "registered",
      rootPath: join(tmp, "agents"),
      label: SELF_SOURCE_LABEL,
      gitRemote: "git@github.com:eliharoun/agent-smith.git",
    };
    const out = await resolveAllSources(r, { resolveSelf: async () => self });
    expect(out).toHaveLength(1);
    expect(out[0]?.gitRemote).toBe("git@github.com:eliharoun/agent-smith.git");
    expect(out[0]?.label).toBe(SELF_SOURCE_LABEL);
  });

  test("gitRemote is undefined on the synthetic source when injected resolver omits it", async () => {
    const r = reg([]);
    const self: Source = {
      kind: "registered",
      rootPath: join(tmp, "agents"),
      label: SELF_SOURCE_LABEL,
    };
    const out = await resolveAllSources(r, { resolveSelf: async () => self });
    expect(out).toHaveLength(1);
    expect(out[0]?.gitRemote).toBeUndefined();
  });

  test("injected resolveSelf is awaited (async resolver result is consumed, not returned as a Promise)", async () => {
    const r = reg([{ kind: "user-global", rootPath: "/u", label: "u" }]);
    const self: Source = {
      kind: "registered",
      rootPath: join(tmp, "agents"),
      label: SELF_SOURCE_LABEL,
    };
    let resolved = false;
    const out = await resolveAllSources(r, {
      resolveSelf: async () => {
        // Simulate genuine async work; resolveAllSources must await it
        // rather than treat the Promise as a Source.
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
        return self;
      },
    });
    expect(resolved).toBe(true);
    expect(out).toEqual([...r.sources, self]);
    // Sanity: the appended entry is the awaited Source, not a Promise-like.
    expect(out[out.length - 1]).toEqual(self);
  });
});
