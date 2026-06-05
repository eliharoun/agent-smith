import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateLoadFailures,
  type BundleLoadFailure,
  findBundleOrFail,
  loadAllBundles,
  warnAllLoadFailures,
  warnUnrelatedLoadFailures,
} from "../../src/cli/load-all";
import { SmithError } from "../../src/core/smith-error";
import type { AgentBundle } from "../../src/core/types";
import { SELF_SOURCE_LABEL, type Registry } from "../../src/io/registry";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-loadall-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeBundle(root: string, name: string) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "agent.config.json"),
    JSON.stringify({
      name,
      description: "Use to test",
      targets: ["opencode"],
      modelTier: "balanced",
    }),
  );
  await writeFile(join(dir, "IDENTITY.md"), `You are ${name}`);
  await writeFile(join(dir, "EXPERTISE.md"), "You do");
  await writeFile(join(dir, "SOUL.md"), "You speak");
  await writeFile(join(dir, "USER.md"), "You note");
}

async function writeBrokenBundle(root: string, name: string) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "agent.config.json"), "{ not valid json");
}

describe("cli/load-all", () => {
  test("loads bundles from all registered sources", async () => {
    await writeBundle(tmp, "alpha");
    await writeBundle(tmp, "beta");
    const result = await loadAllBundles(
      {
        schemaVersion: 2,
        sources: [{ kind: "user-global", rootPath: tmp, label: "u" }],
      },
      { resolveSources: (r) => Promise.resolve(r.sources) },
    );
    const names = result.bundles.map((b) => b.config.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("includes synthetic self-source bundles contributed by resolveAllSources", async () => {
    // resolveAllSources contributes a synthetic source pointing at the
    // running CLI's bundled `agents/` dir. When loadAllBundles iterates
    // via resolveAllSources, those bundles must appear in the result —
    // identifiable by source.label === SELF_SOURCE_LABEL. This proves
    // the wiring without depending on the explicit registry fixture.
    const result = await loadAllBundles({
      schemaVersion: 2,
      sources: [{ kind: "user-global", rootPath: tmp, label: "u" }],
    });
    const selfBundles = result.bundles.filter(
      (b) => b.source.label === SELF_SOURCE_LABEL,
    );
    expect(selfBundles.length).toBeGreaterThan(0);
    expect(selfBundles.some((b) => b.config.name === "agent-smith")).toBe(true);
  });
});

describe("loadAllBundles envelope", () => {
  test("returns {bundles, failures} with failures empty on all-good catalog", async () => {
    await writeBundle(tmp, "good");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [{ kind: "user-global", rootPath: tmp, label: "test" }],
    };
    const result = await loadAllBundles(reg, {
      resolveSources: (r) => Promise.resolve(r.sources),
    });
    expect(result.bundles.length).toBe(1);
    expect(result.bundles[0]?.config.name).toBe("good");
    expect(result.failures).toEqual([]);
  });

  test("captures per-bundle failures with sourceKind, sourceLabel, bundlePath, reason", async () => {
    await writeBrokenBundle(tmp, "bad");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [{ kind: "user-global", rootPath: tmp, label: "test" }],
    };
    const result = await loadAllBundles(reg, {
      resolveSources: (r) => Promise.resolve(r.sources),
    });
    expect(result.bundles).toEqual([]);
    expect(result.failures.length).toBe(1);
    const f = result.failures[0]!;
    expect(f.sourceKind).toBe("user-global");
    expect(f.sourceLabel).toBe("test");
    expect(f.bundlePath).toBe(join(tmp, "bad"));
    expect(typeof f.reason).toBe("string");
    expect(f.reason.length).toBeGreaterThan(0);
  });

  test("partial: returns good bundles AND failure list when mixed", async () => {
    await writeBundle(tmp, "good");
    await writeBrokenBundle(tmp, "bad");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [{ kind: "user-global", rootPath: tmp, label: "test" }],
    };
    const result = await loadAllBundles(reg, {
      resolveSources: (r) => Promise.resolve(r.sources),
    });
    expect(result.bundles.length).toBe(1);
    expect(result.bundles[0]?.config.name).toBe("good");
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]?.bundlePath).toBe(join(tmp, "bad"));
  });
});

const fakeBundle = (name: string): AgentBundle => ({
  bundlePath: `/fake/${name}`,
  source: { kind: "user-global", rootPath: "/fake", label: "test" },
  config: {
    schemaVersion: 1,
    name,
    description: "Use to test",
    modelTier: "balanced",
    targets: ["opencode"],
  },
  files: {
    identity: `You are ${name}`,
    expertise: "You do",
    soul: "You speak",
    user: "You note",
  },
});

describe("findBundleOrFail", () => {
  test("returns the bundle when found by name", () => {
    const result = { bundles: [fakeBundle("foo"), fakeBundle("bar")], failures: [] };
    const b = findBundleOrFail(result, "foo");
    expect(b.config.name).toBe("foo");
  });

  test("throws partial-failure when bundle name matches a failure's basename", () => {
    const result = {
      bundles: [],
      failures: [
        {
          sourceKind: "user-global" as const,
          sourceLabel: "test",
          bundlePath: "/fake/foo",
          reason: "config invalid",
        },
      ],
    };
    let caught: unknown;
    try {
      findBundleOrFail(result, "foo");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("partial-failure");
    if (e.payload.code === "partial-failure") {
      expect(e.payload.failed).toBe(1);
      expect(e.payload.succeeded).toBe(0);
      expect(e.payload.details[0]).toContain("foo");
      expect(e.payload.details[0]).toContain("config invalid");
    }
  });

  test("throws not-found when neither bundles nor failures match", () => {
    const result = { bundles: [fakeBundle("bar")], failures: [] };
    let caught: unknown;
    try {
      findBundleOrFail(result, "foo");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("not-found");
  });
});

describe("aggregateLoadFailures", () => {
  test("returns null when no failures and no extras", () => {
    expect(aggregateLoadFailures("op", 5, [])).toBeNull();
  });

  test("returns SmithError with combined failures and extras", () => {
    const failures = [
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat-a",
        bundlePath: "/cat-a/foo",
        reason: "boom",
      },
    ];
    const err = aggregateLoadFailures("install all", 3, failures, ["bar: validation x"], 1);
    expect(err).not.toBeNull();
    expect(err!.payload.code).toBe("partial-failure");
    if (err!.payload.code === "partial-failure") {
      expect(err!.payload.operation).toBe("install all");
      expect(err!.payload.succeeded).toBe(3);
      expect(err!.payload.failed).toBe(2);
      expect(err!.payload.details).toEqual([
        "[cat-a] /cat-a/foo: boom",
        "bar: validation x",
      ]);
    }
  });

  test("returns SmithError when only extras provided (no load failures)", () => {
    const err = aggregateLoadFailures("agent validate", 2, [], ["agent-x: failed"], 1);
    expect(err).not.toBeNull();
    if (err!.payload.code === "partial-failure") {
      expect(err!.payload.failed).toBe(1);
      expect(err!.payload.details).toEqual(["agent-x: failed"]);
    }
  });
});

describe("warnUnrelatedLoadFailures", () => {
  test("skips the failure whose basename matches the target", () => {
    const calls: string[] = [];
    const failures = [
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat",
        bundlePath: "/cat/foo",
        reason: "boom",
      },
    ];
    warnUnrelatedLoadFailures(failures, "foo", (m) => calls.push(m));
    expect(calls).toEqual([]);
  });

  test("warns for each unrelated failure with sourceLabel/bundlePath/reason", () => {
    const calls: string[] = [];
    const failures = [
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat",
        bundlePath: "/cat/a",
        reason: "boom-a",
      },
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat",
        bundlePath: "/cat/b",
        reason: "boom-b",
      },
    ];
    warnUnrelatedLoadFailures(failures, "target", (m) => calls.push(m));
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("cat");
    expect(calls[0]).toContain("/cat/a");
    expect(calls[0]).toContain("boom-a");
    expect(calls[1]).toContain("/cat/b");
    expect(calls[1]).toContain("boom-b");
  });

  test("no-op on empty failures array", () => {
    const calls: string[] = [];
    warnUnrelatedLoadFailures([], "x", (m) => calls.push(m));
    expect(calls.length).toBe(0);
  });
});

describe("warnAllLoadFailures", () => {
  test("no-op on empty failures", () => {
    const calls: string[] = [];
    warnAllLoadFailures([], (m) => calls.push(m));
    expect(calls.length).toBe(0);
  });

  test("warns each failure with sourceLabel/bundlePath/reason", () => {
    const calls: string[] = [];
    const failures = [
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat-a",
        bundlePath: "/cat-a/foo",
        reason: "boom-foo",
      },
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat-b",
        bundlePath: "/cat-b/bar",
        reason: "boom-bar",
      },
    ];
    warnAllLoadFailures(failures, (m) => calls.push(m));
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("cat-a");
    expect(calls[0]).toContain("/cat-a/foo");
    expect(calls[0]).toContain("boom-foo");
    expect(calls[1]).toContain("cat-b");
    expect(calls[1]).toContain("/cat-b/bar");
    expect(calls[1]).toContain("boom-bar");
  });

  test("uses the provided printer (not stderr)", () => {
    const calls: string[] = [];
    const failures = [
      {
        sourceKind: "user-global" as const,
        sourceLabel: "cat",
        bundlePath: "/cat/x",
        reason: "boom",
      },
    ];
    warnAllLoadFailures(failures, (m) => calls.push(m));
    expect(calls.length).toBe(1);
  });

  test("appends a staleness hint exactly once when failures look schema-shaped", () => {
    const calls: string[] = [];
    const failures: BundleLoadFailure[] = [
      {
        sourceKind: "user-global",
        sourceLabel: "user-global",
        bundlePath: "/p/q",
        reason: "agent.config.json validation failed: knowledge.sources.0: Unrecognized key: \"lazy\"",
      },
      {
        sourceKind: "user-global",
        sourceLabel: "user-global",
        bundlePath: "/p/r",
        reason: "agent.config.json validation failed: knowledge.sources.0: Unrecognized key: \"via\"",
      },
    ];
    warnAllLoadFailures(failures, (m) => calls.push(m));
    expect(calls.length).toBe(3); // 2 warnings + 1 hint line
    expect(calls.at(-1)).toContain("smith daemon stop && smith daemon start");
  });

  test("does NOT append a staleness hint when failures are non-schema-shaped", () => {
    const calls: string[] = [];
    const failures: BundleLoadFailure[] = [
      {
        sourceKind: "user-global",
        sourceLabel: "user-global",
        bundlePath: "/p/q",
        reason: "config-missing: /p/q/agent.config.json",
      },
    ];
    warnAllLoadFailures(failures, (m) => calls.push(m));
    expect(calls.length).toBe(1); // only the warning, no hint
  });
});
