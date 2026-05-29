// tests/core/freshness/remote-catalogs.test.ts
//
// C3.14 (v1-task): unit tests for the doctor `remote-catalogs` helper.
// The helper is pure (no IO; no network) — all inputs are synthetic
// registries.

import { describe, expect, test } from "bun:test";
import { checkRemoteCatalogs } from "../../../src/core/freshness/remote-catalogs";
import type { Registry } from "../../../src/io/registry";
import type { SkillRegistry } from "../../../src/io/skill-registry";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function emptySkillRegistry(): SkillRegistry {
  return { schemaVersion: 2, catalogs: [] };
}

function emptyRegistry(): Registry {
  return { schemaVersion: 2, sources: [] };
}

describe("checkRemoteCatalogs [v1-task C3.14]", () => {
  test("no findings when every catalog is in sync", () => {
    const now = new Date("2026-05-25T00:00:00Z");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [
        {
          kind: "registered",
          rootPath: "/clone/a",
          label: "owner/a",
          gitRemote: "https://example.com/a.git",
          remote: {
            url: "https://example.com/a.git",
            ref: "main",
            lastPulledSha: SHA_A,
            lastPulledAt: now.toISOString(),
            lastRemoteSha: SHA_A,
            lastCheckedAt: now.toISOString(),
          },
        },
      ],
    };
    const r = checkRemoteCatalogs({
      registry: reg,
      skillRegistry: emptySkillRegistry(),
      now,
    });
    expect(r.findings).toEqual([]);
  });

  test("emits catalog-behind-remote when lastPulledSha !== lastRemoteSha", () => {
    const now = new Date("2026-05-25T00:00:00Z");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [
        {
          kind: "registered",
          rootPath: "/clone/a",
          label: "owner/a",
          gitRemote: "https://example.com/a.git",
          remote: {
            url: "https://example.com/a.git",
            ref: "main",
            lastPulledSha: SHA_A,
            lastPulledAt: now.toISOString(),
            lastRemoteSha: SHA_B,
            lastCheckedAt: now.toISOString(),
          },
        },
      ],
    };
    const r = checkRemoteCatalogs({
      registry: reg,
      skillRegistry: emptySkillRegistry(),
      now,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      kind: "agent",
      label: "owner/a",
      finding: "catalog-behind-remote",
    });
    expect(r.findings[0]?.detail).toContain("aaaaaaaa");
    expect(r.findings[0]?.detail).toContain("bbbbbbbb");
  });

  test("emits catalog-stale-check when lastCheckedAt is older than threshold", () => {
    const now = new Date("2026-05-25T00:00:00Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const reg: Registry = {
      schemaVersion: 2,
      sources: [
        {
          kind: "registered",
          rootPath: "/clone/a",
          label: "owner/a",
          gitRemote: "https://example.com/a.git",
          remote: {
            url: "https://example.com/a.git",
            ref: "main",
            lastPulledSha: SHA_A,
            lastPulledAt: tenDaysAgo.toISOString(),
            lastRemoteSha: SHA_A,
            lastCheckedAt: tenDaysAgo.toISOString(),
          },
        },
      ],
    };
    const r = checkRemoteCatalogs({
      registry: reg,
      skillRegistry: emptySkillRegistry(),
      now,
      stalenessMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.finding).toBe("catalog-stale-check");
    expect(r.findings[0]?.detail).toMatch(/10 day/);
  });

  test("skips non-remote catalogs (no remote block)", () => {
    const now = new Date("2026-05-25T00:00:00Z");
    const reg: Registry = {
      schemaVersion: 2,
      sources: [
        {
          kind: "user-global",
          rootPath: "/home/user/agents",
          label: "user-global",
        },
      ],
    };
    const r = checkRemoteCatalogs({
      registry: reg,
      skillRegistry: emptySkillRegistry(),
      now,
    });
    expect(r.findings).toEqual([]);
  });

  test("walks skill registry the same way as agent registry", () => {
    const now = new Date("2026-05-25T00:00:00Z");
    const skillReg: SkillRegistry = {
      schemaVersion: 2,
      catalogs: [
        {
          kind: "team-shared",
          rootPath: "/clone/s",
          label: "owner/skills",
          gitRemote: "https://example.com/skills.git",
          remote: {
            url: "https://example.com/skills.git",
            ref: "main",
            lastPulledSha: SHA_A,
            lastPulledAt: now.toISOString(),
            lastRemoteSha: SHA_B,
            lastCheckedAt: now.toISOString(),
          },
        },
      ],
    };
    const r = checkRemoteCatalogs({
      registry: emptyRegistry(),
      skillRegistry: skillReg,
      now,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      kind: "skill",
      label: "owner/skills",
      finding: "catalog-behind-remote",
    });
  });
});
