import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import type { InstallPaths } from "../../src/core/types";
import type { KnowledgePaths } from "../../src/io/knowledge-paths";
import { removeBundle } from "../../src/io/uninstaller";
import { fakeBundle } from "../_helpers/fakeBundle";

async function makePaths(): Promise<{
  paths: InstallPaths;
  knowledgePaths: KnowledgePaths;
  agentSmithHome: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "smith-partial-rm-"));
  const agentSmithHome = join(root, ".agent-smith");
  await mkdir(agentSmithHome, { recursive: true });
  const paths: InstallPaths = {
    opencode: join(root, "opencode"),
    "claude-code": join(root, "claude"),
    codex: join(root, "codex"),
    kiro: join(root, "kiro"),
    "agents-md": join(root, "agents-md")
  };
  await mkdir(paths.opencode, { recursive: true });
  await mkdir(paths["claude-code"], { recursive: true });
  await mkdir(paths.codex, { recursive: true });
  return { paths, knowledgePaths: { agentSmithHome }, agentSmithHome };
}

describe("removeBundle partialRemoval", () => {
  test("preserves the knowledge dir when remainingTargets is non-empty", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    // Pre-create knowledge dir with a sentinel file.
    const knowledgeDir = join(agentSmithHome, "knowledge", "foo");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, "sentinel.md"), "keep me", "utf8");
    // Pre-create the opencode agent file so removeBundle has something to remove.
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const filtered = fakeBundle("foo", { targets: ["opencode"] }); // "claude-code" stays installed

    const result = await removeBundle(filtered, paths, knowledgePaths, {
      partialRemoval: {
        removedTargets: ["opencode"],
        remainingTargets: ["claude-code"],
      },
    });

    expect(result.knowledgeRemoved).toBe(false);
    expect(result.knowledgeNotFound).toBe(false);
    // Sentinel is still there.
    const kept = await readFile(join(knowledgeDir, "sentinel.md"), "utf8");
    expect(kept).toBe("keep me");
  });

  test("rewrites refresh manifest dropping only filtered platforms", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    await writeRefreshManifest(agentSmithHome, "foo", {
      schemaVersion: 1,
      agent: "foo",
      refresh_consent: {
        granted_at: "2026-05-20T00:00:00.000Z",
        platforms: ["opencode", "claude-code"],
        sources: ["s1"],
      },
    });
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const filtered = fakeBundle("foo", { targets: ["opencode"] });
    await removeBundle(filtered, paths, knowledgePaths, {
      partialRemoval: {
        removedTargets: ["opencode"],
        remainingTargets: ["claude-code"],
      },
      // Use absent codex/opencode homes so hook teardown for "opencode"
      // becomes a no-op (the registration was never written here).
      codexHome: join(agentSmithHome, "codex-home"),
      opencodeConfigHome: join(agentSmithHome, "opencode-home"),
    });

    const raw = await readFile(
      join(agentSmithHome, "refresh", "foo", "refresh-manifest.json"),
      "utf8",
    );
    const m = JSON.parse(raw) as { refresh_consent: { platforms: string[] } };
    expect(m.refresh_consent.platforms).toEqual(["claude-code"]);
  });

  test("deletes refresh manifest when filter consumes the last platform with hooks", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    await writeRefreshManifest(agentSmithHome, "foo", {
      schemaVersion: 1,
      agent: "foo",
      refresh_consent: {
        granted_at: "2026-05-20T00:00:00.000Z",
        platforms: ["opencode"],
        sources: ["s1"],
      },
    });
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const filtered = fakeBundle("foo", { targets: ["opencode"] });
    await removeBundle(filtered, paths, knowledgePaths, {
      // remainingTargets is non-empty (claude-code still has files), but the
      // *manifest* only listed opencode. After dropping opencode, the manifest
      // platforms list is empty => delete the manifest entirely.
      partialRemoval: {
        removedTargets: ["opencode"],
        remainingTargets: ["claude-code"],
      },
      codexHome: join(agentSmithHome, "codex-home"),
      opencodeConfigHome: join(agentSmithHome, "opencode-home"),
    });

    let stillThere = false;
    try {
      await readFile(
        join(agentSmithHome, "refresh", "foo", "refresh-manifest.json"),
        "utf8",
      );
      stillThere = true;
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  });

  test("default (no partialRemoval) still tears down knowledge and manifest fully", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    const knowledgeDir = join(agentSmithHome, "knowledge", "foo");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, "sentinel.md"), "x", "utf8");
    await writeRefreshManifest(agentSmithHome, "foo", {
      schemaVersion: 1,
      agent: "foo",
      refresh_consent: {
        granted_at: "2026-05-20T00:00:00.000Z",
        platforms: ["opencode"],
        sources: ["s1"],
      },
    });
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const bundle = fakeBundle("foo", { targets: ["opencode"] });
    const result = await removeBundle(bundle, paths, knowledgePaths, {
      codexHome: join(agentSmithHome, "codex-home"),
      opencodeConfigHome: join(agentSmithHome, "opencode-home"),
    });

    expect(result.knowledgeRemoved).toBe(true);
    // Manifest should be gone after a full uninstall — the knowledge-only
    // assertion above was insufficient because removeRefreshManifest is the
    // separate code path that the partial branch overrides.
    let manifestStillThere = false;
    try {
      await readFile(
        join(agentSmithHome, "refresh", "foo", "refresh-manifest.json"),
        "utf8",
      );
      manifestStillThere = true;
    } catch {
      manifestStillThere = false;
    }
    expect(manifestStillThere).toBe(false);
  });

  test("treats partialRemoval with empty remainingTargets as full removal", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    const knowledgeDir = join(agentSmithHome, "knowledge", "foo");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, "sentinel.md"), "x", "utf8");
    await writeRefreshManifest(agentSmithHome, "foo", {
      schemaVersion: 1,
      agent: "foo",
      refresh_consent: {
        granted_at: "2026-05-20T00:00:00.000Z",
        platforms: ["opencode"],
        sources: ["s1"],
      },
    });
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const bundle = fakeBundle("foo", { targets: ["opencode"] });
    // Empty remainingTargets is the foot-gun the normalization protects
    // against: a caller computing "what's left" might pass `[]` and expect
    // full uninstall semantics rather than an awkward partial that preserves
    // knowledge while wiping every platform.
    const result = await removeBundle(bundle, paths, knowledgePaths, {
      partialRemoval: { removedTargets: ["opencode"], remainingTargets: [] },
      codexHome: join(agentSmithHome, "codex-home"),
      opencodeConfigHome: join(agentSmithHome, "opencode-home"),
    });

    // Knowledge should be removed (full-removal semantics).
    expect(result.knowledgeRemoved).toBe(true);
    // Manifest should be gone.
    let manifestStillThere = false;
    try {
      await readFile(
        join(agentSmithHome, "refresh", "foo", "refresh-manifest.json"),
        "utf8",
      );
      manifestStillThere = true;
    } catch {
      manifestStillThere = false;
    }
    expect(manifestStillThere).toBe(false);
  });

  test("preserves manifest entries for orphan platforms not in either list", async () => {
    const { paths, knowledgePaths, agentSmithHome } = await makePaths();
    // Manifest lists opencode + codex. CLI is removing opencode and keeping
    // claude-code. codex is an "orphan" — recorded in the manifest but in
    // neither `removedTargets` nor `remainingTargets`. Expectation: the
    // codex entry survives the rewrite (we don't have authority to remove
    // a platform the caller didn't explicitly target).
    await writeRefreshManifest(agentSmithHome, "foo", {
      schemaVersion: 1,
      agent: "foo",
      refresh_consent: {
        granted_at: "2026-05-20T00:00:00.000Z",
        platforms: ["opencode", "codex"],
        sources: ["s1"],
      },
    });
    await writeFile(join(paths.opencode, "foo.md"), "x", "utf8");

    const filtered = fakeBundle("foo", { targets: ["opencode"] });
    await removeBundle(filtered, paths, knowledgePaths, {
      partialRemoval: {
        removedTargets: ["opencode"],
        remainingTargets: ["claude-code"],
      },
      codexHome: join(agentSmithHome, "codex-home"),
      opencodeConfigHome: join(agentSmithHome, "opencode-home"),
    });

    const raw = await readFile(
      join(agentSmithHome, "refresh", "foo", "refresh-manifest.json"),
      "utf8",
    );
    const m = JSON.parse(raw) as { refresh_consent: { platforms: string[] } };
    // Only opencode is dropped; codex orphan is preserved.
    expect(m.refresh_consent.platforms).toEqual(["codex"]);
  });
});
