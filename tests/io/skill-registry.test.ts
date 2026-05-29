import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  addCatalog,
  defaultSkillRegistry,
  loadSkillRegistry,
  removeCatalog,
  renameCatalog,
  type SkillCatalog,
  saveSkillRegistry,
} from "../../src/io/skill-registry";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-reg-"));
  path = join(dir, "skill-catalogs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("io/skill-registry — load/save", () => {
  test("loadSkillRegistry returns default when file is missing — atlassian-skills seeded", async () => {
    const reg = await loadSkillRegistry(path);
    expect(reg.schemaVersion).toBe(2);
    expect(reg.catalogs.length).toBe(1);
    expect(reg.catalogs[0]?.label).toBe("atlassian-skills");
    expect(reg.catalogs[0]?.protected).toBe(true);
  });

  test("saveSkillRegistry writes JSON that loadSkillRegistry can re-read identically", async () => {
    const reg = await loadSkillRegistry(path);
    await saveSkillRegistry(path, reg);
    const reread = await loadSkillRegistry(path);
    expect(reread).toEqual(reg);
  });

  test("saveSkillRegistry writes atomically: no temp file remains after success and content is valid JSON", async () => {
    const { readdir } = await import("node:fs/promises");
    let reg = await loadSkillRegistry(path);
    reg = addCatalog(reg, {
      kind: "user-global",
      rootPath: "/tmp/atomic-test",
      label: "atomic",
    }).registry;
    await saveSkillRegistry(path, reg);
    const entries = await readdir(dir);
    // No leftover temp files (`*.tmp.*`) after a successful write.
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
    // Final file contains the new catalog and is valid JSON.
    const text = await Bun.file(path).text();
    const parsed = JSON.parse(text);
    expect(parsed.catalogs.some((c: { label: string }) => c.label === "atomic")).toBe(true);
  });

  test("loadSkillRegistry rejects unknown version", async () => {
    await Bun.write(path, JSON.stringify({ version: 999, catalogs: [] }));
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-version");
    expect(err.payload.current).toBe(999);
    expect(err.payload.expected).toBe(2);
    expect(err.payload.path).toBe(path);
  });

  test("loadSkillRegistry rejects malformed JSON with a clear error", async () => {
    await Bun.write(path, "{not json");
    await expect(loadSkillRegistry(path)).rejects.toThrow();
  });

  test("loadSkillRegistry malformed JSON error names the path and mentions JSON", async () => {
    await Bun.write(path, "{not json");
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-json");
    expect(err.payload.path).toBe(path);
    expect(err.payload.parseError).toMatch(/json/i);
  });

  test("loadSkillRegistry rejects when 'catalogs' is missing", async () => {
    await Bun.write(path, JSON.stringify({ version: 1 }));
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(err.payload.reasons.some((r: string) => r.includes("catalogs: must be an array"))).toBe(
      true,
    );
  });

  test("loadSkillRegistry rejects when 'catalogs' is an object, not an array", async () => {
    await Bun.write(path, JSON.stringify({ version: 1, catalogs: {} }));
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(err.payload.reasons.some((r: string) => r.includes("catalogs: must be an array"))).toBe(
      true,
    );
  });

  test("loadSkillRegistry rejects when a catalog is missing 'label'", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [{ kind: "user-global", rootPath: "/tmp/x" }],
      }),
    );
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(
      err.payload.reasons.some((r: string) => r.includes("catalogs[0].label: must be a string")),
    ).toBe(true);
  });

  test("loadSkillRegistry rejects when a catalog has non-string 'kind'", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [{ kind: 42, rootPath: "/tmp/x", label: "x" }],
      }),
    );
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(
      err.payload.reasons.some((r: string) => r.includes("catalogs[0].kind: must be a string")),
    ).toBe(true);
  });

  test("loadSkillRegistry rejects when a catalog has non-boolean 'protected'", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [{ kind: "user-global", rootPath: "/tmp/x", label: "x", protected: "yes" }],
      }),
    );
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(
      err.payload.reasons.some((r: string) =>
        r.includes("catalogs[0].protected: must be a boolean"),
      ),
    ).toBe(true);
  });

  test("loadSkillRegistry error payload includes the registry path", async () => {
    await Bun.write(path, JSON.stringify({ version: 1, catalogs: "nope" }));
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    expect(err.payload.path).toBe(path);
  });

  test("accumulates multiple per-catalog reasons into one SmithError", async () => {
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [
          { kind: "user-global", rootPath: "/x", label: "ok" },
          { kind: 42, rootPath: "/y", protected: "yes" },
        ],
      }),
    );
    const err = await loadSkillRegistry(path).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("skill-registry-corrupt-shape");
    const reasons = err.payload.reasons;
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    expect(reasons.some((r: string) => r.includes("catalogs[1].kind"))).toBe(true);
    expect(reasons.some((r: string) => r.includes("catalogs[1].label"))).toBe(true);
    expect(reasons.some((r: string) => r.includes("catalogs[1].protected"))).toBe(true);
  });
});

describe("io/skill-registry — addCatalog/removeCatalog", () => {
  const sample: SkillCatalog = {
    kind: "user-global",
    rootPath: "/tmp/skills-x",
    label: "x",
  };

  test("addCatalog appends a catalog and persists", async () => {
    let reg = await loadSkillRegistry(path);
    const before = reg.catalogs.length;
    reg = addCatalog(reg, sample).registry;
    await saveSkillRegistry(path, reg);
    const reread = await loadSkillRegistry(path);
    expect(reread.catalogs.length).toBe(before + 1);
    expect(reread.catalogs.some((c) => c.label === "x")).toBe(true);
  });

  test("addCatalog is idempotent on (kind, rootPath) — duplicate add is a no-op", async () => {
    let reg = await loadSkillRegistry(path);
    reg = addCatalog(reg, sample).registry;
    const len = reg.catalogs.length;
    reg = addCatalog(reg, sample).registry;
    expect(reg.catalogs.length).toBe(len);
  });

  test("addCatalog rejects duplicate label with already-exists SmithError", async () => {
    let reg = await loadSkillRegistry(path);
    reg = addCatalog(reg, sample).registry;
    let caught: unknown;
    try {
      addCatalog(reg, { kind: "user-local", rootPath: "/tmp/skills-y", label: "x" });
      throw new Error("expected addCatalog to throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("already-exists");
    if (payload.code === "already-exists") {
      expect(payload.what).toBe("skill catalog label");
      expect(payload.identifier).toBe("x");
      expect(payload.suggestedCommand).toContain("smith skill register");
    }
  });

  test("removeCatalog by label removes the matching catalog", async () => {
    let reg = await loadSkillRegistry(path);
    reg = addCatalog(reg, sample).registry;
    reg = removeCatalog(reg, "x");
    expect(reg.catalogs.some((c) => c.label === "x")).toBe(false);
  });

  test("removeCatalog by rootPath removes the matching catalog", async () => {
    let reg = await loadSkillRegistry(path);
    reg = addCatalog(reg, sample).registry;
    reg = removeCatalog(reg, "/tmp/skills-x");
    expect(reg.catalogs.some((c) => c.label === "x")).toBe(false);
  });

  test("removeCatalog returns the registry unchanged when no match", async () => {
    const reg = await loadSkillRegistry(path);
    const after = removeCatalog(reg, "nonexistent");
    expect(after.catalogs.length).toBe(reg.catalogs.length);
  });
});

describe("addCatalog return shape", () => {
  test("status='added' for new entry", () => {
    const reg = defaultSkillRegistry();
    const result = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "a",
      adhoc: true,
    });
    expect(result.status).toBe("added");
    if (result.status === "added") {
      // @ts-expect-error - "added" branch has no existingLabel field
      result.existingLabel;
    }
    expect(result.registry.catalogs).toHaveLength(2);
    expect(result.registry.catalogs.at(-1)?.label).toBe("a");
  });

  test("status='noop-same-label' for identical re-add", () => {
    const reg = defaultSkillRegistry();
    const first = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "a",
      adhoc: true,
    });
    const second = addCatalog(first.registry, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "a",
      adhoc: true,
    });
    expect(second.status).toBe("noop-same-label");
    if (second.status !== "added") {
      const label: string = second.existingLabel;
      expect(label).toBe("a");
    }
    expect(second.registry).toBe(first.registry);
  });

  test("status='noop-different-label' for same path different label", () => {
    const reg = defaultSkillRegistry();
    const first = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "original",
      adhoc: true,
    });
    const second = addCatalog(first.registry, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "different",
      adhoc: true,
    });
    expect(second.status).toBe("noop-different-label");
    if (second.status !== "added") {
      const label: string = second.existingLabel;
      expect(label).toBe("original");
    }
    expect(second.registry).toBe(first.registry);
    expect(second.registry.catalogs.at(-1)?.label).toBe("original");
  });

  test("throws already-exists when label collides on different path", () => {
    const reg = defaultSkillRegistry();
    const first = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "shared",
      adhoc: true,
    });
    expect(() =>
      addCatalog(first.registry, {
        kind: "user-local",
        rootPath: "/tmp/b",
        label: "shared",
        adhoc: true,
      }),
    ).toThrow();
  });
});

describe("renameCatalog", () => {
  test("renames an existing label", () => {
    const { registry: reg } = addCatalog(defaultSkillRegistry(), {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "old",
      adhoc: true,
    });
    const result = renameCatalog(reg, "old", "new");
    expect(result.catalogs.find((c) => c.rootPath === "/tmp/a")?.label).toBe("new");
  });

  test("throws not-found when oldLabel missing", () => {
    const reg = defaultSkillRegistry();
    const err = (() => {
      try {
        renameCatalog(reg, "missing", "new");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("not-found");
  });

  test("throws already-exists when newLabel taken by another catalog", () => {
    let reg = defaultSkillRegistry();
    reg = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "a",
      adhoc: true,
    }).registry;
    reg = addCatalog(reg, {
      kind: "user-local",
      rootPath: "/tmp/b",
      label: "b",
      adhoc: true,
    }).registry;
    const err = (() => {
      try {
        renameCatalog(reg, "a", "b");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SmithError);
    expect((err as SmithError).payload.code).toBe("already-exists");
  });

  test("allows rename to same label (no-op returns same reference)", () => {
    const { registry: reg } = addCatalog(defaultSkillRegistry(), {
      kind: "user-local",
      rootPath: "/tmp/a",
      label: "same",
      adhoc: true,
    });
    const result = renameCatalog(reg, "same", "same");
    expect(result).toBe(reg);
    expect(result.catalogs.find((c) => c.rootPath === "/tmp/a")?.label).toBe("same");
  });
});
