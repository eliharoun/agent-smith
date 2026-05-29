import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobHistoryWriter } from "./job-history";
import { JobManager, type Spawner } from "./job-manager";

const fakeSpawner: Spawner = (_argv, handlers) => {
  handlers.onStdout("line1\n");
  handlers.onStdout("line2\n");
  handlers.onExit(0);
  return { stop: () => {}, writeStdin: () => {} };
};

const failingSpawner: Spawner = (_argv, handlers) => {
  handlers.onStderr("boom\n");
  handlers.onExit(1);
  return { stop: () => {}, writeStdin: () => {} };
};

describe("JobManager", () => {
  it("starts a job, streams events, exits cleanly", async () => {
    const jm = new JobManager({ spawner: fakeSpawner });
    const { id } = jm.start({
      command: "doctor",
      argv: ["doctor"],
      preview: "smith doctor",
      lockKeys: [],
    });
    await jm.waitForExit(id);
    const job = jm.get(id);
    expect(job?.status).toBe("succeeded");
    expect(job?.exitCode).toBe(0);
  });

  it("marks a non-zero exit as failed", async () => {
    const jm = new JobManager({ spawner: failingSpawner });
    const { id } = jm.start({
      command: "doctor",
      argv: ["doctor"],
      preview: "smith doctor",
      lockKeys: [],
    });
    await jm.waitForExit(id);
    expect(jm.get(id)?.status).toBe("failed");
  });

  it("refuses to start when lock keys are held", () => {
    const jm = new JobManager({ spawner: fakeSpawner });
    jm.start({
      command: "agent.install",
      argv: ["agent", "install", "foo"],
      preview: "smith agent install foo",
      lockKeys: ["agent:foo"],
    });
    expect(() =>
      jm.start({
        command: "agent.install",
        argv: ["agent", "install", "foo"],
        preview: "smith agent install foo",
        lockKeys: ["agent:foo"],
      }),
    ).toThrow(/locked/);
  });

  it("evicts jobs beyond capacity", async () => {
    const jm = new JobManager({ spawner: fakeSpawner, maxJobs: 2 });
    const a = jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] }).id;
    const b = jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] }).id;
    await Promise.all([jm.waitForExit(a), jm.waitForExit(b)]);
    const c = jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] }).id;
    await jm.waitForExit(c);
    expect(jm.get(a)?.status).toBe("evicted");
    expect(jm.get(b)?.status).not.toBe("evicted");
    expect(jm.get(c)?.status).toBe("succeeded");
  });

  describe("evictIfNeeded", () => {
    // Spawner that never exits — required so eviction targets are still "running"
    // when capacity is exceeded.
    function makeNeverExitSpawner() {
      const stopped: number[] = [];
      let nextIdx = 0;
      const spawner: Spawner = (_argv, _handlers) => {
        const idx = nextIdx++;
        return {
          stop: () => {
            stopped.push(idx);
          },
          writeStdin: () => {},
        };
      };
      return { spawner, stopped };
    }

    it("stops the subprocess of an evicted still-running job", () => {
      const { spawner, stopped } = makeNeverExitSpawner();
      const jm = new JobManager({ spawner, maxJobs: 2 });
      const a = jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] }).id;
      jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] });
      jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] });
      // First spawn (idx 0) belongs to job `a`, which should be the eviction target.
      expect(stopped).toEqual([0]);
      expect(jm.get(a)?.status).toBe("evicted");
    });

    it("releases locks held by an evicted job so future jobs can acquire them", () => {
      const { spawner } = makeNeverExitSpawner();
      const jm = new JobManager({ spawner, maxJobs: 2 });
      jm.start({
        command: "agent.install",
        argv: ["agent", "install", "foo"],
        preview: "x",
        lockKeys: ["agent:foo"],
      });
      jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] });
      jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] });
      // The first job (holding agent:foo) is now evicted. A new job should be able
      // to acquire that key.
      expect(() =>
        jm.start({
          command: "agent.install",
          argv: ["agent", "install", "foo"],
          preview: "x",
          lockKeys: ["agent:foo"],
        }),
      ).not.toThrow();
    });

    it("resolves waitForExit() for evicted jobs so callers do not hang", async () => {
      const { spawner } = makeNeverExitSpawner();
      const jm = new JobManager({ spawner, maxJobs: 1 });
      const a = jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] }).id;
      jm.start({ command: "doctor", argv: ["doctor"], preview: "x", lockKeys: [] });
      const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 100),
      );
      const result = await Promise.race([
        jm.waitForExit(a).then(() => "resolved" as const),
        timeout,
      ]);
      expect(result).toBe("resolved");
    });
  });

  describe("history wiring", () => {
    it("persists job summaries and per-job output when history is configured", async () => {
      const dir = await mkdtemp(join(tmpdir(), "jm-hist-"));
      try {
        const jsonlPath = join(dir, "g.jsonl");
        const outputDir = join(dir, "out");
        const history = createJobHistoryWriter({ jsonlPath, outputDir });
        let onExit: ((code: number) => void) | null = null;
        const spawner: Spawner = (_argv, handlers) => {
          handlers.onStdout("hello\n");
          handlers.onStderr("warn\n");
          onExit = handlers.onExit;
          return { stop() {}, writeStdin() {} };
        };
        const jm = new JobManager({ spawner, history });
        const { id } = jm.start({
          command: "doctor",
          argv: ["doctor"],
          preview: "smith doctor",
          lockKeys: [],
        });
        onExit!(0);
        await jm.waitForExit(id);
        // Allow the history queue to flush (sink close + jsonl append).
        await new Promise((r) => setTimeout(r, 80));
        const raw = await readFile(jsonlPath, "utf8");
        const line = JSON.parse(raw.trim().split("\n")[0]!);
        expect(line.id).toBe(id);
        expect(line.command).toBe("doctor");
        expect(line.argvPreview).toBe("smith doctor");
        expect(line.exitCode).toBe(0);
        expect(typeof line.startedAt).toBe("number");
        expect(typeof line.endedAt).toBe("number");
        const log = await readFile(join(outputDir, `${id}.log`), "utf8");
        expect(log).toContain("hello");
        expect(log).toContain("warn");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("works without history configured (back-compat)", async () => {
      const jm = new JobManager({ spawner: fakeSpawner });
      const { id } = jm.start({
        command: "doctor",
        argv: ["doctor"],
        preview: "smith doctor",
        lockKeys: [],
      });
      await jm.waitForExit(id);
      expect(jm.get(id)?.status).toBe("succeeded");
    });

    it("sets degraded and warnings when output contains warning prefixes", async () => {
      const dir = await mkdtemp(join(tmpdir(), "jm-warn-"));
      try {
        const jsonlPath = join(dir, "g.jsonl");
        const outputDir = join(dir, "out");
        const history = createJobHistoryWriter({ jsonlPath, outputDir });
        let onExit: ((code: number) => void) | null = null;
        const spawner: Spawner = (_argv, handlers) => {
          handlers.onStdout("ok line\n");
          handlers.onStderr("warn: confluence page not reachable\n");
          handlers.onStdout("⚠ skipped stale source\n");
          onExit = handlers.onExit;
          return { stop() {}, writeStdin() {} };
        };
        const jm = new JobManager({ spawner, history });
        const { id } = jm.start({
          command: "knowledge.fetch",
          argv: ["knowledge", "fetch"],
          preview: "smith knowledge fetch",
          lockKeys: [],
        });
        onExit!(0);
        await jm.waitForExit(id);
        await new Promise((r) => setTimeout(r, 80));
        const raw = await readFile(jsonlPath, "utf8");
        const line = JSON.parse(raw.trim().split("\n")[0]!);
        expect(line.degraded).toBe(true);
        expect(line.warnings).toEqual([
          "warn: confluence page not reachable",
          "⚠ skipped stale source",
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not set degraded when exit code is non-zero", async () => {
      const dir = await mkdtemp(join(tmpdir(), "jm-nowarn-"));
      try {
        const jsonlPath = join(dir, "g.jsonl");
        const outputDir = join(dir, "out");
        const history = createJobHistoryWriter({ jsonlPath, outputDir });
        let onExit: ((code: number) => void) | null = null;
        const spawner: Spawner = (_argv, handlers) => {
          handlers.onStderr("warn: something\n");
          onExit = handlers.onExit;
          return { stop() {}, writeStdin() {} };
        };
        const jm = new JobManager({ spawner, history });
        const { id } = jm.start({
          command: "doctor",
          argv: ["doctor"],
          preview: "smith doctor",
          lockKeys: [],
        });
        onExit!(1);
        await jm.waitForExit(id);
        await new Promise((r) => setTimeout(r, 80));
        const raw = await readFile(jsonlPath, "utf8");
        const line = JSON.parse(raw.trim().split("\n")[0]!);
        expect(line.degraded).toBeUndefined();
        expect(line.warnings).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("envOverrides plumbing", () => {
    it("threads envOverrides through to the spawner's opts.env", () => {
      let receivedEnv: Record<string, string> | undefined;
      const spawner: Spawner = (_argv, handlers, opts) => {
        receivedEnv = opts?.env;
        handlers.onExit(0);
        return { stop() {}, writeStdin() {} };
      };
      const jm = new JobManager({ spawner });
      jm.start({
        command: "daemon.start",
        argv: ["daemon", "start"],
        preview: "smith daemon start",
        lockKeys: ["daemon"],
        envOverrides: { SMITH_PULL_INTERVAL_MS: "60000" },
      });
      expect(receivedEnv).toEqual({ SMITH_PULL_INTERVAL_MS: "60000" });
    });

    it("omits opts when no envOverrides set", () => {
      let receivedOpts: unknown = "unset";
      const spawner: Spawner = (_argv, handlers, opts) => {
        receivedOpts = opts;
        handlers.onExit(0);
        return { stop() {}, writeStdin() {} };
      };
      const jm = new JobManager({ spawner });
      jm.start({
        command: "doctor",
        argv: ["doctor"],
        preview: "smith doctor",
        lockKeys: [],
      });
      expect(receivedOpts).toBeUndefined();
    });
  });
});
