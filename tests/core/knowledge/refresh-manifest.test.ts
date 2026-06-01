import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRefreshManifest,
  refreshManifestPath,
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
      const path = join(dir, "refresh", "broken", "refresh-manifest.json");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(dir, "refresh", "broken"), { recursive: true });
      await writeFile(path, "{ not json", "utf8");
      await expect(readRefreshManifest(dir, "broken")).rejects.toThrow(
        /refresh-manifest.json/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Bug B: refresh manifest must NOT live under <stateHome>/agents/<name>/
  // (which is the registered-source bundle layout) — it lives at the
  // sibling path <stateHome>/refresh/<name>/refresh-manifest.json. This
  // prevents writeRefreshManifest from creating a phantom bundle dir under
  // the user-global agents catalog when the source is the synthetic self-
  // source (whose bundle lives in the running CLI's repo, NOT user-global).
  describe("path layout (Bug B)", () => {
    test("refreshManifestPath returns <stateHome>/refresh/<name>/refresh-manifest.json", () => {
      expect(refreshManifestPath("/state", "my-agent")).toBe(
        "/state/refresh/my-agent/refresh-manifest.json",
      );
    });

    test("writeRefreshManifest writes to the sibling refresh/ path, not agents/", async () => {
      const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-path-"));
      try {
        const manifest: RefreshManifest = {
          schemaVersion: 1,
          agent: "phantom-test",
          refresh_consent: {
            granted_at: "2026-05-18T10:23:00Z",
            platforms: ["claude-code"],
            sources: ["x"],
          },
        };
        await writeRefreshManifest(dir, "phantom-test", manifest);
        // Written at the new path
        const newPath = join(dir, "refresh", "phantom-test", "refresh-manifest.json");
        await expect(stat(newPath)).resolves.toBeDefined();
        // NOT written at the legacy bundle-dir path
        const legacyPath = join(dir, "agents", "phantom-test", "refresh-manifest.json");
        await expect(stat(legacyPath)).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("writeRefreshManifest does not create <stateHome>/agents/<name>/", async () => {
      const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-noghost-"));
      try {
        const manifest: RefreshManifest = {
          schemaVersion: 1,
          agent: "no-ghost",
          refresh_consent: {
            granted_at: "2026-05-18T10:23:00Z",
            platforms: ["claude-code"],
            sources: ["x"],
          },
        };
        await writeRefreshManifest(dir, "no-ghost", manifest);
        // No phantom bundle dir under agents/.
        const agentsDir = join(dir, "agents");
        await expect(stat(agentsDir)).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("readRefreshManifest reads from the new sibling path", async () => {
      const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-read-"));
      try {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const manifest: RefreshManifest = {
          schemaVersion: 1,
          agent: "explicit",
          refresh_consent: {
            granted_at: "2026-05-18T10:23:00Z",
            platforms: ["claude-code"],
            sources: [],
          },
        };
        const newDir = join(dir, "refresh", "explicit");
        await mkdir(newDir, { recursive: true });
        await writeFile(
          join(newDir, "refresh-manifest.json"),
          JSON.stringify(manifest),
          "utf8",
        );
        const round = await readRefreshManifest(dir, "explicit");
        expect(round).toEqual(manifest);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("readRefreshManifest does NOT read from the legacy <stateHome>/agents/<name>/ path", async () => {
      const dir = await mkdtemp(join(tmpdir(), "refresh-manifest-legacy-"));
      try {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const legacyDir = join(dir, "agents", "leftover");
        await mkdir(legacyDir, { recursive: true });
        await writeFile(
          join(legacyDir, "refresh-manifest.json"),
          JSON.stringify({
            schemaVersion: 1,
            agent: "leftover",
            refresh_consent: {
              granted_at: "2026-01-01T00:00:00Z",
              platforms: ["claude-code"],
              sources: [],
            },
          }),
          "utf8",
        );
        // Reader looks in refresh/, not agents/, so the legacy file is invisible.
        const round = await readRefreshManifest(dir, "leftover");
        expect(round).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
