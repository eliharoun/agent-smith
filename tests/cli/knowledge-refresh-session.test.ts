import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeRefreshSession } from "../../src/cli/commands/knowledge/refresh-session";
import { runRefreshSession } from "../../src/cli/commands/knowledge/refresh-session-runner";
import { readRefreshCache, writeRefreshCache } from "../../src/core/knowledge/refresh-cache";
import { acquireRefreshLock, releaseRefreshLock } from "../../src/core/knowledge/refresh-lock";

describe("runRefreshSession", () => {
  // Each test gets its own tmp lockDir so per-source advisory locks don't
  // bleed across tests OR pollute the developer's real ~/.cache/agent-smith.
  let lockDir: string;
  beforeEach(async () => {
    lockDir = await mkdtemp(join(tmpdir(), "rs-runner-"));
  });
  afterEach(async () => {
    await rm(lockDir, { recursive: true, force: true });
  });
  test("returns empty result when no agents have refreshable sources", async () => {
    const result = await runRefreshSession({
      agents: [
        {
          name: "static-only",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [{ id: "s1" }],
        },
      ],
      refreshSource: mock(async () => ({ ok: true as const })),
      budgetMs: 5000,
      lockDir,
    });
    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped.length).toBe(1);
  });

  test("filters to session/always modes; install mode is skipped", async () => {
    const refreshSource = mock(async () => ({ ok: true as const }));
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [
            { id: "session-src", refresh: { mode: "session" } },
            { id: "always-src", refresh: { mode: "always" } },
            { id: "install-src" },
            { id: "ttl-src", refresh: { mode: "ttl", ttl: "1h" } },
          ],
        },
      ],
      refreshSource,
      budgetMs: 5000,
      lockDir,
    });
    expect(result.refreshed.map((r) => r.sourceId).sort()).toEqual(["always-src", "session-src"]);
    expect(refreshSource).toHaveBeenCalledTimes(2);
  });

  test("filters by --agent when provided", async () => {
    const refreshSource = mock(async () => ({ ok: true as const }));
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [{ id: "s1", refresh: { mode: "session" } }],
        },
        {
          name: "b",
          targets: ["claude-code"],
          sources: [{ id: "s2", refresh: { mode: "session" } }],
        },
      ],
      refreshSource,
      budgetMs: 5000,
      agentFilter: "b",
      lockDir,
    });
    expect(result.refreshed.map((r) => r.sourceId)).toEqual(["s2"]);
    expect(refreshSource).toHaveBeenCalledTimes(1);
  });

  test("source failure is captured in failed list, others continue", async () => {
    const refreshSource = mock(async (_agent: string, sourceId: string) => {
      if (sourceId === "bad") return { ok: false as const, error: "network unreachable" };
      return { ok: true as const };
    });
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [
            { id: "good", refresh: { mode: "session" } },
            { id: "bad", refresh: { mode: "session" } },
          ],
        },
      ],
      refreshSource,
      budgetMs: 5000,
      lockDir,
    });
    expect(result.refreshed.map((r) => r.sourceId)).toEqual(["good"]);
    expect(result.failed.map((f) => f.sourceId)).toEqual(["bad"]);
    expect(result.failed[0]?.error).toMatch(/network unreachable/);
  });

  test("source thrown exception is captured, never propagates", async () => {
    const refreshSource = mock(async () => {
      throw new Error("boom");
    });
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [{ id: "s1", refresh: { mode: "session" } }],
        },
      ],
      refreshSource,
      budgetMs: 5000,
      lockDir,
    });
    expect(result.failed.map((f) => f.sourceId)).toEqual(["s1"]);
    expect(result.failed[0]?.error).toMatch(/boom/);
  });

  test("global budget kills slow sources", async () => {
    const refreshSource = mock(async (_a: string, sourceId: string) => {
      if (sourceId === "slow") {
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { ok: true as const };
    });
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [
            { id: "fast", refresh: { mode: "session" } },
            { id: "slow", refresh: { mode: "session" } },
          ],
        },
      ],
      refreshSource,
      budgetMs: 100,
      lockDir,
    });
    expect(result.refreshed.map((r) => r.sourceId)).toContain("fast");
    expect(result.failed.map((f) => f.sourceId)).toContain("slow");
    expect(result.failed.find((f) => f.sourceId === "slow")?.error).toMatch(/budget|timeout/i);
  });

  test("regression: no pending timers leak when sources finish before budget", async () => {
    // Source resolves immediately; budget is 60s. If the per-task budget
    // timer isn't cleared, the event loop stays alive for 60s. We assert
    // the runner returns promptly AND that totalDurationMs reflects only
    // the source work, not the budget.
    const result = await runRefreshSession({
      agents: [
        {
          name: "a",
          targets: ["claude-code" as const, "codex" as const, "opencode" as const],
          sources: [{ id: "s1", refresh: { mode: "session" as const } }],
        },
      ],
      refreshSource: mock(async () => ({ ok: true as const })),
      budgetMs: 60000,
      lockDir,
    });
    expect(result.refreshed.map((r) => r.sourceId)).toEqual(["s1"]);
    // Source resolves on next tick; total should be well under 100ms even
    // on a slow CI box. If a timer leaked, totalDurationMs would be ~60000.
    expect(result.totalDurationMs).toBeLessThan(1000);
  });

  test("acquires per-source advisory lock; concurrent invocation skips with reason=lock-held", async () => {
    // Two concurrent runRefreshSession calls against the SAME lockDir for
    // the SAME (agent, sourceId). The first acquires the lock; the second
    // must see it held and record a skip rather than re-running the fetch.
    // We assert: (a) the source fn ran exactly once across both invocations,
    // (b) at least one of the two results contains a skipped entry with
    // reason="lock-held".
    let calls = 0;
    const slow = async () => {
      calls += 1;
      // Hold the lock long enough for the second invocation to observe it
      // before release. 50ms is well under the 30s staleness window.
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true as const };
    };
    const agents = [
      {
        name: "a",
        targets: ["claude-code" as const, "codex" as const, "opencode" as const],
        sources: [{ id: "s1", refresh: { mode: "session" as const } }],
      },
    ];
    const [r1, r2] = await Promise.all([
      runRefreshSession({ agents, refreshSource: slow, budgetMs: 2000, lockDir }),
      runRefreshSession({ agents, refreshSource: slow, budgetMs: 2000, lockDir }),
    ]);
    expect(calls).toBe(1);
    const allSkipped = [...r1.skipped, ...r2.skipped];
    expect(allSkipped.some((s) => s.reason === "lock-held")).toBe(true);
  });

  describe("refresh-cache write", () => {
    let cacheRoot: string;
    beforeEach(async () => {
      cacheRoot = await mkdtemp(join(tmpdir(), "rs-cache-"));
    });
    afterEach(async () => {
      await rm(cacheRoot, { recursive: true, force: true });
    });

    test("writes refresh-cache entry on successful refresh", async () => {
      await runRefreshSession({
        agents: [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" } }],
          },
        ],
        refreshSource: async () => ({ ok: true as const }),
        budgetMs: 5000,
        lockDir: cacheRoot,
        cacheRoot,
      });
      const entry = await readRefreshCache(cacheRoot, "a", "s1");
      expect(entry).toBeDefined();
      if (!entry) throw new Error("unreachable: asserted above");
      expect(entry.last_error).toBeNull();
      expect(entry.last_refreshed_at).toBeDefined();
      expect(Number.isNaN(Date.parse(entry.last_refreshed_at))).toBe(false);
      expect(entry.last_attempt_at).toBe(entry.last_refreshed_at);
    });

    test("failed refresh preserves prior last_refreshed_at, updates last_attempt_at + last_error", async () => {
      const priorAt = "2026-05-18T08:00:00.000Z";
      await writeRefreshCache(cacheRoot, "a", "s1", {
        schemaVersion: 1,
        last_refreshed_at: priorAt,
        last_attempt_at: priorAt,
        last_error: null,
      });
      await runRefreshSession({
        agents: [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" } }],
          },
        ],
        refreshSource: async () => ({ ok: false as const, error: "network down" }),
        budgetMs: 5000,
        lockDir: cacheRoot,
        cacheRoot,
      });
      const entry = await readRefreshCache(cacheRoot, "a", "s1");
      expect(entry?.last_refreshed_at).toBe(priorAt);
      expect(entry?.last_error).toBe("network down");
      expect(entry?.last_attempt_at).not.toBe(priorAt);
    });

    test("budget-timeout does NOT write a cache entry", async () => {
      const result = await runRefreshSession({
        agents: [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" } }],
          },
        ],
        refreshSource: () => new Promise(() => {}),
        budgetMs: 50,
        lockDir: cacheRoot,
        cacheRoot,
      });
      expect(result.failed.map((f) => f.sourceId)).toEqual(["s1"]);
      expect(result.failed[0]?.error).toMatch(/exceeded .* budget/);
      const entry = await readRefreshCache(cacheRoot, "a", "s1");
      expect(entry).toBeUndefined();
    });

    test("cache-write failure calls errLog and does not crash", async () => {
      // Pre-create a regular file where the agents/<agent> directory would
      // need to live. mkdir(..., recursive: true) fails with ENOTDIR when a
      // path component exists as a non-directory, which causes
      // writeRefreshCache to throw — exercising the swallow-and-log branch.
      const blockPath = join(cacheRoot, "agents");
      await writeFile(blockPath, "blocker", "utf8");
      const errLogs: string[] = [];
      const result = await runRefreshSession({
        agents: [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" } }],
          },
        ],
        refreshSource: async () => ({ ok: true as const }),
        budgetMs: 5000,
        lockDir: cacheRoot,
        cacheRoot,
        errLog: (m) => errLogs.push(m),
      });
      expect(result.refreshed.length).toBe(1);
      expect(errLogs.length).toBe(1);
      expect(errLogs[0]).toMatch(/cache write failed for a\/s1/);
    });

    test("lock-held source does NOT write a cache entry", async () => {
      const held = await acquireRefreshLock(cacheRoot, "a", "s1");
      expect(held).toBeDefined();
      if (!held) throw new Error("unreachable: asserted above");
      try {
        const result = await runRefreshSession({
          agents: [
            {
              name: "a",
              targets: ["claude-code" as const, "codex" as const, "opencode" as const],
              sources: [{ id: "s1", refresh: { mode: "session" } }],
            },
          ],
          refreshSource: async () => ({ ok: true as const }),
          budgetMs: 5000,
          lockDir: cacheRoot,
          cacheRoot,
        });
        expect(result.skipped.some((s) => s.sourceId === "s1" && s.reason === "lock-held")).toBe(
          true,
        );
        const entry = await readRefreshCache(cacheRoot, "a", "s1");
        expect(entry).toBeUndefined();
      } finally {
        await releaseRefreshLock(held);
      }
    });
  });
});

describe("knowledgeRefreshSession (CLI entrypoint)", () => {
  test("returns exit code 0 on success with stdout summary", async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const exitCode = await knowledgeRefreshSession(
      {},
      {
        listAgents: async () => [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" as const } }],
          },
        ],
        refreshSource: async () => ({ ok: true as const }),
        log: (m) => logs.push(m),
        err: (m) => errs.push(m),
      },
    );
    expect(exitCode).toBe(0);
    expect(errs).toEqual([]);
  });

  test("returns exit code 0 even when sources fail (soft-fail)", async () => {
    const errs: string[] = [];
    const exitCode = await knowledgeRefreshSession(
      {},
      {
        listAgents: async () => [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "bad", refresh: { mode: "session" as const } }],
          },
        ],
        refreshSource: async () => ({ ok: false as const, error: "401 unauthorized" }),
        log: () => {},
        err: (m) => errs.push(m),
      },
    );
    expect(exitCode).toBe(0);
    expect(errs.join("\n")).toMatch(/bad.*401 unauthorized/);
  });

  test("--json emits structured stdout", async () => {
    const logs: string[] = [];
    await knowledgeRefreshSession(
      { json: true },
      {
        listAgents: async () => [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" as const } }],
          },
        ],
        refreshSource: async () => ({ ok: true as const }),
        log: (m) => logs.push(m),
        err: () => {},
      },
    );
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toHaveProperty("refreshed");
    expect(parsed).toHaveProperty("failed");
    expect(parsed).toHaveProperty("totalDurationMs");
  });

  test("--agent filters to the named agent", async () => {
    const calls: string[] = [];
    await knowledgeRefreshSession(
      { agent: "b" },
      {
        listAgents: async () => [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" as const } }],
          },
          {
            name: "b",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s2", refresh: { mode: "session" as const } }],
          },
        ],
        refreshSource: async (agent, sourceId) => {
          calls.push(`${agent}/${sourceId}`);
          return { ok: true as const };
        },
        log: () => {},
        err: () => {},
      },
    );
    expect(calls).toEqual(["b/s2"]);
  });

  test("NaN --timeout (e.g. from `--timeout abc`) falls back to default, warns on stderr", async () => {
    // commander's parseInt parser returns NaN on non-numeric input. `??`
    // does not catch NaN, so without the defensive guard NaN would reach
    // setTimeout and every source would instantly "expire". We assert the
    // guard kicks in: source runs successfully (proving budget wasn't NaN)
    // and a one-line warning appears on stderr.
    const errs: string[] = [];
    const exitCode = await knowledgeRefreshSession(
      { timeout: Number.NaN },
      {
        listAgents: async () => [
          {
            name: "a",
            targets: ["claude-code" as const, "codex" as const, "opencode" as const],
            sources: [{ id: "s1", refresh: { mode: "session" as const } }],
          },
        ],
        refreshSource: async () => ({ ok: true as const }),
        log: () => {},
        err: (m) => errs.push(m),
      },
    );
    expect(exitCode).toBe(0);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/invalid --timeout/);
  });
});

describe("refresh-session production wiring (smoke)", () => {
  test("listInstalledAgentsForRefresh returns array (may be empty in test env)", async () => {
    const { listInstalledAgentsForRefresh } = await import(
      "../../src/cli/commands/knowledge/refresh-session-agents"
    );
    const agents = await listInstalledAgentsForRefresh();
    expect(Array.isArray(agents)).toBe(true);
    // Every agent has name + sources array; per-source fields present.
    for (const a of agents) {
      expect(typeof a.name).toBe("string");
      expect(Array.isArray(a.sources)).toBe(true);
      for (const s of a.sources) {
        expect(typeof s.id).toBe("string");
      }
    }
  });
});
