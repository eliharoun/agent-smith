import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import { addSource, loadRegistry, removeSource, renameSource, saveRegistry } from "../../src/io/registry";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-reg-"));
  path = join(dir, "registry.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("io/registry", () => {
  test("loadRegistry returns default when file is missing", async () => {
    const reg = await loadRegistry(path);
    expect(reg.schemaVersion).toBe(2);
    expect(reg.sources.some((s) => s.kind === "user-global")).toBe(true);
  });

  test("saveRegistry writes JSON that loadRegistry can read", async () => {
    const reg = await loadRegistry(path);
    await saveRegistry(path, reg);
    const reread = await loadRegistry(path);
    expect(reread).toEqual(reg);
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(reg);
  });

  test("addSource appends a source and persists", async () => {
    let reg = await loadRegistry(path);
    reg = addSource(reg, {
      kind: "project",
      rootPath: "/x/.agent-smith/agents",
      label: "project:x",
    }).registry;
    await saveRegistry(path, reg);
    const reread = await loadRegistry(path);
    expect(reread.sources.some((s) => s.label === "project:x")).toBe(true);
  });

  test("addSource is idempotent on (kind, rootPath)", async () => {
    let reg = await loadRegistry(path);
    const s = { kind: "project" as const, rootPath: "/x", label: "x" };
    reg = addSource(reg, s).registry;
    reg = addSource(reg, s).registry;
    expect(reg.sources.filter((x) => x.rootPath === "/x")).toHaveLength(1);
  });

  test("removeSource by rootPath", async () => {
    let reg = await loadRegistry(path);
    reg = addSource(reg, { kind: "project", rootPath: "/x", label: "x" }).registry;
    reg = removeSource(reg, "/x");
    expect(reg.sources.some((s) => s.rootPath === "/x")).toBe(false);
  });

  test("rejects unknown registry version", async () => {
    await Bun.write(path, JSON.stringify({ version: 999, sources: [] }));
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-version");
    expect(err.payload.current).toBe(999);
    expect(err.payload.expected).toBe(2);
    expect(err.payload.path).toBe(path);
  });

  test("throws SmithError({code:'registry-corrupt-json'}) on malformed JSON", async () => {
    await Bun.write(path, "{not json");
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-corrupt-json");
    expect(err.payload.path).toBe(path);
    expect(err.payload.parseError).toBeTruthy();
  });

  test("addSource rejects duplicate label across distinct rootPaths", async () => {
    let reg = await loadRegistry(path);
    reg = addSource(reg, { kind: "project", rootPath: "/x", label: "shared" }).registry;
    expect(() =>
      addSource(reg, { kind: "project", rootPath: "/y", label: "shared" }),
    ).toThrow(/already in use|shared/i);
  });

  test("addSource same (kind, rootPath) repeated stays a no-op even if label matches itself", async () => {
    let reg = await loadRegistry(path);
    const s = { kind: "project" as const, rootPath: "/x", label: "x" };
    reg = addSource(reg, s).registry;
    reg = addSource(reg, s).registry;
    expect(reg.sources.filter((x) => x.label === "x")).toHaveLength(1);
  });

  test("saveRegistry never leaves a half-written file (atomic via temp+rename)", async () => {
    // Pre-populate with a known-good registry, then concurrently overwrite
    // it many times. After all writes resolve, the file must parse cleanly.
    // A naive Bun.write would race here; the atomic write guarantees the
    // post-state is always one of the inputs in full.
    let reg = await loadRegistry(path);
    reg = addSource(reg, { kind: "project", rootPath: "/seed", label: "seed" }).registry;
    await saveRegistry(path, reg);

    const writes = Array.from({ length: 10 }, async (_, i) => {
      const r = addSource(reg, {
        kind: "project",
        rootPath: `/concurrent/${i}`,
        label: `concurrent-${i}`,
      }).registry;
      await saveRegistry(path, r);
    });
    await Promise.all(writes);

    // Whichever writer "won", the file must still be valid JSON parseable
    // back to a Registry.
    const reread = await loadRegistry(path);
    expect(reread.schemaVersion).toBe(2);
    expect(reread.sources.length).toBeGreaterThan(0);
  });
});

describe("addSource return shape", () => {
  test("status='added' for new entry", () => {
    const reg = { schemaVersion: 2 as const, sources: [] };
    const result = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "a",
    });
    expect(result.status).toBe("added");
    if (result.status === "added") {
      // @ts-expect-error - "added" branch has no existingLabel field
      result.existingLabel;
    }
    expect(result.registry.sources).toHaveLength(1);
  });

  test("status='noop-same-label' for identical re-add", () => {
    const reg = { schemaVersion: 2 as const, sources: [] };
    const first = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "a",
    });
    const second = addSource(first.registry, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "a",
    });
    expect(second.status).toBe("noop-same-label");
    if (second.status !== "added") {
      const label: string = second.existingLabel;
      expect(label).toBe("a");
    }
    expect(second.registry).toBe(first.registry);
  });

  test("status='noop-different-label' for same path different label", () => {
    const reg = { schemaVersion: 2 as const, sources: [] };
    const first = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "original",
    });
    const second = addSource(first.registry, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "different",
    });
    expect(second.status).toBe("noop-different-label");
    if (second.status !== "added") {
      const label: string = second.existingLabel;
      expect(label).toBe("original");
    }
    expect(second.registry).toBe(first.registry);
  });

  test("throws already-exists when label collides on different path", () => {
    const reg = { schemaVersion: 2 as const, sources: [] };
    const first = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "shared",
    });
    expect(() =>
      addSource(first.registry, {
        kind: "registered",
        rootPath: "/tmp/b",
        label: "shared",
      }),
    ).toThrow();
  });
});

describe("loadRegistry shape validation (IO-6)", () => {
  test("rejects non-array sources", async () => {
    await Bun.write(path, JSON.stringify({ schemaVersion: 2, sources: "nope" }));
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-corrupt-shape");
    expect(err.payload.reasons.some((r: string) => r.includes("sources"))).toBe(true);
  });

  test("rejects unknown source kind", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        sources: [
          { kind: "user-glabal", rootPath: "/x", label: "x" },
        ],
      }),
    );
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-corrupt-shape");
    expect(
      err.payload.reasons.some((r: string) => r.includes("user-glabal")),
    ).toBe(true);
  });

  test("rejects missing rootPath", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", label: "x" }],
      }),
    );
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-corrupt-shape");
    expect(
      err.payload.reasons.some((r: string) => r.includes("rootPath")),
    ).toBe(true);
  });

  test("collects multiple errors in one throw", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        sources: [
          { kind: "user-global", label: "ok-one", rootPath: "/x" },
          { kind: "bogus", rootPath: 42, label: "ok-two" },
          { kind: "registered", label: "" },
        ],
      }),
    );
    const err = await loadRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("registry-corrupt-shape");
    expect(err.payload.reasons.length).toBeGreaterThanOrEqual(3);
    // Distinct problem types — guards against all reasons coming from a
    // single source's missing-fields cascade.
    expect(err.payload.reasons.some((r: string) => r.includes("'bogus'"))).toBe(true);
    expect(err.payload.reasons.some((r: string) => r.includes("rootPath"))).toBe(true);
    expect(err.payload.reasons.some((r: string) => r.includes("label"))).toBe(true);
    // Problems span at least two source indices.
    const indices = new Set(
      err.payload.reasons
        .map((r: string) => r.match(/sources\[(\d+)\]/)?.[1])
        .filter(Boolean),
    );
    expect(indices.size).toBeGreaterThanOrEqual(2);
  });

  test("accepts a fully-valid registry", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        sources: [
          { kind: "user-global", rootPath: "/a", label: "a" },
          { kind: "project", rootPath: "/b", label: "b" },
        ],
      }),
    );
    const reg = await loadRegistry(path);
    expect(reg.sources).toHaveLength(2);
  });
});

describe("renameSource", () => {
  test("renames an existing label", () => {
    const start = { schemaVersion: 2 as const, sources: [] };
    const { registry: reg } = addSource(start, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "old",
    });
    const result = renameSource(reg, "old", "new");
    expect(result.sources.find((s) => s.rootPath === "/tmp/a")?.label).toBe(
      "new",
    );
  });

  test("throws not-found when oldLabel missing", () => {
    const err = (() => {
      try {
        renameSource({ schemaVersion: 2, sources: [] }, "missing", "new");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  test("throws already-exists when newLabel taken", () => {
    let reg: { schemaVersion: 2; sources: import("../../src/core/types").Source[] } = {
      schemaVersion: 2,
      sources: [],
    };
    reg = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/a",
      label: "a",
    }).registry;
    reg = addSource(reg, {
      kind: "registered",
      rootPath: "/tmp/b",
      label: "b",
    }).registry;
    const err = (() => {
      try {
        renameSource(reg, "a", "b");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("already-exists");
  });

  test("rename to same label is no-op (same reference)", () => {
    const { registry: reg } = addSource(
      { schemaVersion: 2 as const, sources: [] },
      { kind: "registered", rootPath: "/tmp/a", label: "same" },
    );
    expect(renameSource(reg, "same", "same")).toBe(reg);
  });
});
