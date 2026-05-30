import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import type { Source } from "../../src/core/types";
import { loadBundle } from "../../src/io/bundle-loader";

let tmp: string;
let source: Source;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-bundle-"));
  source = { kind: "user-global", rootPath: tmp, label: "test" };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeBundle(dir: string, opts: { withUser?: boolean } = {}) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "agent.config.json"),
    JSON.stringify(
      {
        name: "demo",
        description: "Use to demo loading",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, "IDENTITY.md"), "You are a demo.");
  await writeFile(join(dir, "EXPERTISE.md"), "You demo things.");
  await writeFile(join(dir, "SOUL.md"), "You speak demoishly.");
  if (opts.withUser !== false) {
    await writeFile(join(dir, "USER.md"), "Local user content.");
  }
}

describe("io/bundle-loader", () => {
  test("loads a complete bundle", async () => {
    const dir = join(tmp, "demo");
    await writeBundle(dir);
    const bundle = await loadBundle(dir, source);
    expect(bundle.config.name).toBe("demo");
    expect(bundle.files.identity).toBe("You are a demo.");
    expect(bundle.files.user).toBe("Local user content.");
    expect(bundle.bundlePath).toBe(dir);
  });

  test("resolves USER.md symlink", async () => {
    const dir = join(tmp, "demo");
    await writeBundle(dir, { withUser: false });
    const target = join(tmp, "actual-user.md");
    await writeFile(target, "Symlinked user content.");
    await symlink(target, join(dir, "USER.md"));
    const bundle = await loadBundle(dir, source);
    expect(bundle.files.user).toBe("Symlinked user content.");
  });

  test("falls back to canonical USER.md if no local file", async () => {
    const dir = join(tmp, "demo");
    await writeBundle(dir, { withUser: false });
    const canonical = join(tmp, "canonical-user.md");
    await writeFile(canonical, "Canonical user.");
    const bundle = await loadBundle(dir, source, { canonicalUserPath: canonical });
    expect(bundle.files.user).toBe("Canonical user.");
  });

  test("throws SmithError(config-missing) if agent.config.json is missing", async () => {
    const dir = join(tmp, "broken");
    await mkdir(dir);
    const configPath = join(dir, "agent.config.json");
    let caught: unknown = null;
    try {
      await loadBundle(dir, source);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "config-missing") {
      expect(payload.path).toBe(configPath);
      expect(payload.suggestedCommand).toBe("smith agent init <name>");
    } else {
      throw new Error(`expected config-missing, got ${payload.code}`);
    }
  });

  test("throws SmithError(validation-failed) if config schema is invalid", async () => {
    const dir = join(tmp, "broken");
    await mkdir(dir);
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify({ name: "BadCase", description: "x", targets: [], modelTier: "balanced" }),
    );
    await writeFile(join(dir, "IDENTITY.md"), "y");
    await writeFile(join(dir, "EXPERTISE.md"), "y");
    await writeFile(join(dir, "SOUL.md"), "y");
    await writeFile(join(dir, "USER.md"), "y");
    let caught: unknown = null;
    try {
      await loadBundle(dir, source);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("agent.config.json");
      expect(payload.reasons.length).toBeGreaterThan(0);
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
  });

  test("throws SmithError(validation-failed) on JSON parse failure with configPath in reasons and original error as cause", async () => {
    const dir = join(tmp, "badjson");
    await mkdir(dir);
    const configPath = join(dir, "agent.config.json");
    await writeFile(configPath, "{ this is not json");
    let caught: unknown = null;
    try {
      await loadBundle(dir, source);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError & { cause?: unknown };
    const payload = e.payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("agent.config.json");
      expect(payload.reasons[0]).toContain(configPath);
      expect(payload.reasons[0]).toContain("not valid JSON");
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
    expect(e.cause).toBeInstanceOf(Error);
  });

  test("readMaybe propagates non-ENOENT fs errors as SmithError(permission-denied) via classifyFsError", async () => {
    const dir = join(tmp, "demo");
    await writeBundle(dir);
    // Synthesize an EACCES from readFile to exercise the readMaybe error
    // re-throw path. ENOENT is short-circuited (returns null), so this
    // covers what previously was a raw `throw err` re-throw.
    const eaccesErr = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const spy = spyOn(fsPromises, "readFile").mockRejectedValueOnce(eaccesErr);
    let caught: unknown = null;
    try {
      await loadBundle(dir, source);
    } catch (err) {
      caught = err;
    }
    spy.mockRestore();
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "permission-denied") {
      expect(payload.operation).toBe("read");
      expect(payload.path).toBe(join(dir, "agent.config.json"));
    } else {
      throw new Error(`expected permission-denied, got ${payload.code}`);
    }
  });

  test("does not call stat on bundle directory after reading files (IO-4)", async () => {
    // Regression: prior to this fix, loadBundle called stat(bundlePath)
    // after reading the four bundle files. The stat was dead-code (any
    // error stat() could surface would have already surfaced via the
    // readMaybe calls) AND opened a TOCTOU window. This test asserts
    // the stat is gone by spying on node:fs/promises.stat and verifying
    // it is never invoked with bundlePath during loadBundle.
    const dir = join(tmp, "demo");
    await writeBundle(dir);
    const statSpy = spyOn(fsPromises, "stat");
    try {
      const result = await loadBundle(dir, source);
      expect(result.config.name).toBe("demo");
      const calledWithBundle = statSpy.mock.calls.some(
        (args) => args[0] === dir,
      );
      expect(calledWithBundle).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
  });
});
