// tests/core/knowledge/refresh-hooks-map.test.ts
//
// Unit tests for buildRefreshHooksMap — the helper the daemon uses to
// rebuild the per-bundle `withRefreshHooksFor` opt-in map from each
// bundle's on-disk refresh-manifest.json before every reinstall.
//
// Without this map, the orchestrator's fail-closed default would strip
// previously-consented Claude Code SessionStart hooks on every daemon
// reinstall (PHASE-5 task 0).

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBundle } from "../../../src/core/types";
import { buildRefreshHooksMap } from "../../../src/core/knowledge/refresh-hooks-map";
import {
  writeRefreshManifest,
  type RefreshManifest,
} from "../../../src/core/knowledge/refresh-manifest";

function fakeBundle(name: string): AgentBundle {
  // The helper only reads `bundle.config.name`; the rest of the bundle
  // is structurally typed but unused here. Cast through unknown so we
  // don't have to construct a fully-valid CanonicalConfig.
  return {
    config: { name } as unknown as AgentBundle["config"],
    source: { kind: "registered", rootPath: "/fake", label: "fake" } as never,
    bundlePath: `/fake/agents/${name}`,
    files: { identity: "", expertise: "", soul: "", user: "" },
  };
}

function manifest(platforms: RefreshManifest["refresh_consent"]["platforms"]): RefreshManifest {
  return {
    schemaVersion: 1,
    agent: "ignored-by-name-arg",
    refresh_consent: {
      granted_at: "2026-05-18T10:00:00Z",
      platforms,
      sources: ["src-a"],
    },
  };
}

describe("buildRefreshHooksMap", () => {
  test("returns an empty map when no bundles are passed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      const map = await buildRefreshHooksMap(dir, []);
      expect(map.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bundle without a manifest produces no map entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      const map = await buildRefreshHooksMap(dir, [fakeBundle("alpha")]);
      expect(map.size).toBe(0);
      expect(map.has("alpha")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bundle with claude-code-only consent gets a true entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      await writeRefreshManifest(dir, "alpha", manifest(["claude-code"]));
      const map = await buildRefreshHooksMap(dir, [fakeBundle("alpha")]);
      expect(map.get("alpha")).toBe(true);
      expect(map.size).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bundle with codex-only consent gets NO entry (claude-code not consented)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      await writeRefreshManifest(dir, "alpha", manifest(["codex"]));
      const map = await buildRefreshHooksMap(dir, [fakeBundle("alpha")]);
      expect(map.has("alpha")).toBe(false);
      expect(map.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bundle with both claude-code and codex consent gets a true entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      await writeRefreshManifest(dir, "alpha", manifest(["claude-code", "codex"]));
      const map = await buildRefreshHooksMap(dir, [fakeBundle("alpha")]);
      expect(map.get("alpha")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multiple bundles: only the claude-consented ones appear in the map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      await writeRefreshManifest(dir, "alpha", manifest(["claude-code"]));
      await writeRefreshManifest(dir, "beta", manifest(["codex"]));
      // gamma: no manifest written at all
      await writeRefreshManifest(dir, "delta", manifest(["claude-code", "codex"]));

      const map = await buildRefreshHooksMap(dir, [
        fakeBundle("alpha"),
        fakeBundle("beta"),
        fakeBundle("gamma"),
        fakeBundle("delta"),
      ]);

      expect(map.get("alpha")).toBe(true);
      expect(map.has("beta")).toBe(false);
      expect(map.has("gamma")).toBe(false);
      expect(map.get("delta")).toBe(true);
      expect(map.size).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("corrupt manifest causes the helper to throw (fail-loud)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-hooks-map-"));
    try {
      // Hand-write malformed JSON so readRefreshManifest's parse step
      // throws a SmithError. The helper must NOT swallow it.
      const agentDir = join(dir, "agents", "broken");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "refresh-manifest.json"), "{ not json", "utf8");
      await expect(
        buildRefreshHooksMap(dir, [fakeBundle("broken")]),
      ).rejects.toThrow(/refresh-manifest.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
