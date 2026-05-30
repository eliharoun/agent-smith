import { describe, expect, mock, test } from "bun:test";
import type { install as realInstall } from "../../src/cli/commands/install";
import {
  type LoadedBundle,
  type RefreshOneSourceDeps,
  refreshOneSource,
} from "../../src/cli/commands/knowledge/refresh-session-fetch";
import type { refreshSource as realRefreshSource } from "../../src/core/knowledge/refresh-source";
import type { KnowledgeSource } from "../../src/core/knowledge/types";

/**
 * Coverage for the result-kind → wrapper-behavior mapping table in
 * `refresh-session-fetch.ts`. All I/O is stubbed via DI; no temp dirs
 * or real bundles are needed because the wrapper itself is pure glue.
 */

const URL_SOURCE: KnowledgeSource = {
  id: "src-1",
  type: "url",
  delivery: "file",
  url: "https://example.com/x",
};

const NPM_SOURCE: KnowledgeSource = {
  id: "npm-1",
  type: "npm",
  delivery: "file",
  package: "left-pad",
};

function makeBundle(sources: KnowledgeSource[] = [URL_SOURCE]): LoadedBundle {
  return { bundleDir: "/fake/bundle", sources };
}

/** Build a deps bundle with sane stub defaults. Tests override what they
 *  care about; the rest stays inert so an unintentional call fails loud
 *  (install stub returns 0 by default so test 7's fallback path can succeed
 *  without extra setup; tests that assert install was NOT called check the
 *  mock's call count). */
function makeDeps(overrides: Partial<RefreshOneSourceDeps> = {}): {
  deps: RefreshOneSourceDeps;
  refreshSourceImpl: ReturnType<typeof mock>;
  installImpl: ReturnType<typeof mock>;
  loadBundleImpl: ReturnType<typeof mock>;
} {
  const refreshSourceImpl = mock(async () => ({
    kind: "refreshed" as const,
    sourceId: "src-1",
    bytes: 0,
    entries: 0,
    tokens: 0,
    durationMs: 1,
  }));
  const installImpl = mock(async () => 0);
  const loadBundleImpl = mock(async () => makeBundle());
  const deps: RefreshOneSourceDeps = {
    refreshSourceImpl: refreshSourceImpl as unknown as typeof realRefreshSource,
    installImpl: installImpl as unknown as typeof realInstall,
    loadBundleImpl,
    agentSmithHome: "/fake/home",
    ...overrides,
  };
  return { deps, refreshSourceImpl, installImpl, loadBundleImpl };
}

describe("refreshOneSource", () => {
  test("refreshed: returns ok and does not call install", async () => {
    const { deps, installImpl } = makeDeps();
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result).toEqual({ ok: true });
    expect(installImpl).toHaveBeenCalledTimes(0);
  });

  test("inline-only: falls back to install with hook-safe options", async () => {
    const { deps, installImpl } = makeDeps({
      refreshSourceImpl: mock(async () => ({
        kind: "inline-only" as const,
        sourceId: "src-1",
        delivery: "inline" as const,
      })) as unknown as typeof realRefreshSource,
    });
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result).toEqual({ ok: true });
    expect(installImpl).toHaveBeenCalledTimes(1);
    const callArg = installImpl.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ name: "agent-a", skillMode: "no-skills" });
    expect(typeof callArg.print).toBe("function");
  });

  test("inline-only + install non-zero exit: ok=false with descriptive error", async () => {
    const { deps } = makeDeps({
      refreshSourceImpl: mock(async () => ({
        kind: "inline-only" as const,
        sourceId: "src-1",
        delivery: "auto" as const,
      })) as unknown as typeof realRefreshSource,
      installImpl: mock(async () => 1) as unknown as typeof realInstall,
    });
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("install exited with code 1");
    }
  });

  test("lock-held: returns ok without install fallback (another refresh in flight)", async () => {
    const { deps, installImpl } = makeDeps({
      refreshSourceImpl: mock(async () => ({
        kind: "lock-held" as const,
        sourceId: "src-1",
      })) as unknown as typeof realRefreshSource,
    });
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result).toEqual({ ok: true });
    expect(installImpl).toHaveBeenCalledTimes(0);
  });

  test("skipped unsupported-source-type: ok=false with typed error, no install", async () => {
    const { deps, installImpl } = makeDeps({
      loadBundleImpl: mock(async () => makeBundle([NPM_SOURCE])),
      refreshSourceImpl: mock(async () => ({
        kind: "skipped" as const,
        sourceId: "npm-1",
        reason: "unsupported-source-type" as const,
      })) as unknown as typeof realRefreshSource,
    });
    const result = await refreshOneSource("agent-a", "npm-1", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("npm");
      expect(result.error.toLowerCase()).toContain("not refreshable");
    }
    expect(installImpl).toHaveBeenCalledTimes(0);
  });

  test("primitive throws: falls back to install (last-resort recovery)", async () => {
    const { deps, installImpl } = makeDeps({
      refreshSourceImpl: mock(async () => {
        throw new Error("boom");
      }) as unknown as typeof realRefreshSource,
    });
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result).toEqual({ ok: true });
    expect(installImpl).toHaveBeenCalledTimes(1);
  });

  test("sourceId not in bundle: install fallback, primitive not called", async () => {
    const { deps, installImpl, refreshSourceImpl } = makeDeps({
      // Bundle contains only URL_SOURCE (id=src-1); we ask for "missing-id".
      loadBundleImpl: mock(async () => makeBundle()),
    });
    const result = await refreshOneSource("agent-a", "missing-id", deps);
    expect(result).toEqual({ ok: true });
    expect(installImpl).toHaveBeenCalledTimes(1);
    expect(refreshSourceImpl).toHaveBeenCalledTimes(0);
  });

  test("bundle load fails: ok=false, no install, no primitive call", async () => {
    const { deps, installImpl, refreshSourceImpl } = makeDeps({
      loadBundleImpl: mock(async () => {
        throw new Error("bundle gone");
      }),
    });
    const result = await refreshOneSource("agent-a", "src-1", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("bundle gone");
    }
    expect(installImpl).toHaveBeenCalledTimes(0);
    expect(refreshSourceImpl).toHaveBeenCalledTimes(0);
  });
});
