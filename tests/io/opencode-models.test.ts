// tests/io/opencode-models.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetOpenCodeModelsCache,
  _setSpawnForTesting,
  getOpenCodeModels,
} from "../../src/io/opencode-models";

type FakeSpawnResult = {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

function makeSpawn(result: FakeSpawnResult | "throw"): () => FakeSpawnResult {
  return () => {
    if (result === "throw") {
      const err = new Error("ENOENT");
      // @ts-expect-error - mimic Node ENOENT shape
      err.code = "ENOENT";
      throw err;
    }
    return result;
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  _resetOpenCodeModelsCache();
});

afterEach(() => {
  _setSpawnForTesting(null);
  _resetOpenCodeModelsCache();
});

describe("getOpenCodeModels", () => {
  test("parses line-per-model output into trimmed array", async () => {
    _setSpawnForTesting(
      makeSpawn({
        exitCode: 0,
        stdout: enc(
          "github-copilot/claude-opus-4.7\n" +
            "github-copilot/claude-sonnet-4.6\n" +
            "github-copilot/claude-haiku-4.5\n",
        ),
        stderr: enc(""),
      }),
    );
    const r = await getOpenCodeModels();
    expect(r).toEqual([
      "github-copilot/claude-opus-4.7",
      "github-copilot/claude-sonnet-4.6",
      "github-copilot/claude-haiku-4.5",
    ]);
  });

  test("non-zero exit returns undefined", async () => {
    _setSpawnForTesting(
      makeSpawn({ exitCode: 1, stdout: enc(""), stderr: enc("nope\n") }),
    );
    expect(await getOpenCodeModels()).toBeUndefined();
  });

  test("ENOENT (CLI not on PATH) returns undefined", async () => {
    _setSpawnForTesting(makeSpawn("throw"));
    expect(await getOpenCodeModels()).toBeUndefined();
  });

  test("filters stderr-style noise like 'warn: ignoring extra certs'", async () => {
    _setSpawnForTesting(
      makeSpawn({
        exitCode: 0,
        stdout: enc(
          "warn: ignoring extra certs from /opt/cert.pem\n" +
            "github-copilot/claude-opus-4.7\n" +
            "\n" +
            "github-copilot/claude-sonnet-4.6\n" +
            "  \n",
        ),
        stderr: enc(""),
      }),
    );
    const r = await getOpenCodeModels();
    expect(r).toEqual([
      "github-copilot/claude-opus-4.7",
      "github-copilot/claude-sonnet-4.6",
    ]);
  });

  test("zero valid lines returns empty array (distinct from undefined)", async () => {
    _setSpawnForTesting(
      makeSpawn({
        exitCode: 0,
        stdout: enc("warn: only noise\n   \n"),
        stderr: enc(""),
      }),
    );
    const r = await getOpenCodeModels();
    expect(r).toEqual([]);
    expect(r).not.toBeUndefined();
  });

  test("memoizes within process — second call does not re-spawn", async () => {
    let calls = 0;
    _setSpawnForTesting(() => {
      calls++;
      return {
        exitCode: 0,
        stdout: enc("github-copilot/claude-opus-4.7\n"),
        stderr: enc(""),
      };
    });
    const a = await getOpenCodeModels();
    const b = await getOpenCodeModels();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).toEqual(b as string[]);
    expect(calls).toBe(1);
  });

  test("does NOT cache failures — retries on next call (IO-30 regression)", async () => {
    // Long-running processes (notably the daemon) must not have their model
    // resolution permanently disabled by a single transient failure during
    // startup. The cache should only memoize successful queries.
    let calls = 0;
    _setSpawnForTesting(() => {
      calls++;
      // First call: simulate transient failure (opencode missing/crashed).
      if (calls === 1) {
        return { exitCode: 1, stdout: enc(""), stderr: enc("not found\n") };
      }
      // Subsequent calls: opencode is back, returns the model list.
      return {
        exitCode: 0,
        stdout: enc("github-copilot/claude-opus-4.7\n"),
        stderr: enc(""),
      };
    });

    expect(await getOpenCodeModels()).toBeUndefined();
    expect(await getOpenCodeModels()).toEqual([
      "github-copilot/claude-opus-4.7",
    ]);
    expect(calls).toBe(2);
  });

  test("does NOT cache thrown failures (e.g. ENOENT) — retries on next call", async () => {
    let calls = 0;
    _setSpawnForTesting(() => {
      calls++;
      if (calls === 1) {
        const err = new Error("ENOENT");
        // @ts-expect-error - mimic Node ENOENT shape
        err.code = "ENOENT";
        throw err;
      }
      return {
        exitCode: 0,
        stdout: enc("github-copilot/claude-sonnet-4.6\n"),
        stderr: enc(""),
      };
    });

    expect(await getOpenCodeModels()).toBeUndefined();
    expect(await getOpenCodeModels()).toEqual([
      "github-copilot/claude-sonnet-4.6",
    ]);
    expect(calls).toBe(2);
  });

  test("empty-array success IS cached (distinct from failure)", async () => {
    // An opencode CLI that returns zero valid models is still a success, and
    // should be cached just like a non-empty success — otherwise we'd spawn
    // every call indefinitely on a configured-but-empty install.
    let calls = 0;
    _setSpawnForTesting(() => {
      calls++;
      return {
        exitCode: 0,
        stdout: enc("warn: only noise\n"),
        stderr: enc(""),
      };
    });
    expect(await getOpenCodeModels()).toEqual([]);
    expect(await getOpenCodeModels()).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("test-seam guards (production-import safety)", () => {
  // The _setSpawnForTesting and _resetOpenCodeModelsCache helpers are exported
  // for test injection. They MUST throw if called outside a test environment
  // (NODE_ENV !== "test"), so a malicious or careless production import can't
  // rebind the spawn function for the process. We simulate "production" by
  // mutating NODE_ENV temporarily.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    // Restore so subsequent tests in the suite still see NODE_ENV=test.
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  test("_setSpawnForTesting throws when NODE_ENV !== 'test'", () => {
    process.env.NODE_ENV = "production";
    expect(() => _setSpawnForTesting(() => ({
      exitCode: 0,
      stdout: enc(""),
      stderr: enc(""),
    }))).toThrow(/NODE_ENV=test/);
  });

  test("_resetOpenCodeModelsCache throws when NODE_ENV !== 'test'", () => {
    process.env.NODE_ENV = "production";
    expect(() => _resetOpenCodeModelsCache()).toThrow(/NODE_ENV=test/);
  });

  test("_setSpawnForTesting succeeds when NODE_ENV='test'", () => {
    process.env.NODE_ENV = "test";
    expect(() => _setSpawnForTesting(null)).not.toThrow();
  });

  test("_resetOpenCodeModelsCache succeeds when NODE_ENV='test'", () => {
    process.env.NODE_ENV = "test";
    expect(() => _resetOpenCodeModelsCache()).not.toThrow();
  });
});
