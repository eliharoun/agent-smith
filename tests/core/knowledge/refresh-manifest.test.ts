import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRefreshManifest,
  writeRefreshManifest,
  type RefreshManifest,
} from "../../../src/core/knowledge/refresh-manifest";

describe("refresh-manifest", () => {
  test("round-trips a manifest written to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-"));
    try {
      const manifest: RefreshManifest = {
        schemaVersion: 1,
        agent: "my-agent",
        refresh_consent: {
          granted_at: "2026-05-18T10:23:00Z",
          platforms: ["claude-code"],
          sources: ["confluence-runbooks", "jira-issues"],
        },
      };
      await writeRefreshManifest(dir, "my-agent", manifest);
      const round = await readRefreshManifest(dir, "my-agent");
      expect(round).toEqual(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when no manifest exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-"));
    try {
      const round = await readRefreshManifest(dir, "missing-agent");
      expect(round).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed JSON with a SmithError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-"));
    try {
      const path = join(dir, "agents", "broken", "refresh-manifest.json");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(dir, "agents", "broken"), { recursive: true });
      await writeFile(path, "{ not json", "utf8");
      await expect(readRefreshManifest(dir, "broken")).rejects.toThrow(
        /refresh-manifest.json/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
