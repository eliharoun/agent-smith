// tests/core/knowledge/refresh-manifest-schema-version.test.ts
//
// B11.5 (v1-task): refresh-manifests/<agent>.json gains a `schemaVersion: 1`
// field. Greenfield — no pre-existing version field. Writers emit it;
// readers accept legacy manifests (missing field) via lazy in-memory
// migration so a v0.24.0 install on a pre-v0.24.0 home works.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RefreshManifest,
  readRefreshManifest,
  writeRefreshManifest,
} from "../../../src/core/knowledge/refresh-manifest";

describe("RefreshManifest schemaVersion [v1-task B11.5]", () => {
  test("RefreshManifest type includes schemaVersion: 1", () => {
    const m: RefreshManifest = {
      schemaVersion: 1,
      agent: "a",
      refresh_consent: {
        granted_at: "2026-05-24T00:00:00Z",
        platforms: ["claude-code"],
        sources: ["x"],
      },
    };
    expect(m.schemaVersion).toBe(1);
  });

  test("writeRefreshManifest then readRefreshManifest round-trips schemaVersion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rm-sv-"));
    try {
      const manifest: RefreshManifest = {
        schemaVersion: 1,
        agent: "my-agent",
        refresh_consent: {
          granted_at: "2026-05-24T00:00:00Z",
          platforms: ["claude-code"],
          sources: ["src1"],
        },
      };
      await writeRefreshManifest(dir, "my-agent", manifest);
      const round = await readRefreshManifest(dir, "my-agent");
      expect(round?.schemaVersion).toBe(1);
      // Writer emits schemaVersion on disk.
      const raw = JSON.parse(
        await readFile(
          join(dir, "agents", "my-agent", "refresh-manifest.json"),
          "utf8",
        ),
      );
      expect(raw.schemaVersion).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readRefreshManifest tolerates legacy manifest with no schemaVersion (injects 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rm-sv-legacy-"));
    try {
      const path = join(dir, "agents", "legacy", "refresh-manifest.json");
      await mkdir(join(dir, "agents", "legacy"), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          agent: "legacy",
          refresh_consent: {
            granted_at: "2026-05-20T00:00:00Z",
            platforms: ["claude-code"],
            sources: ["s"],
          },
        }),
        "utf8",
      );
      const read = await readRefreshManifest(dir, "legacy");
      expect(read?.schemaVersion).toBe(1);
      expect(read?.agent).toBe("legacy");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
