import { describe, expect, test } from "bun:test";
import { detectPython, pythonNotInstalledRemediation } from "../../src/io/python-runtime";

function makeStubSpawn(map: Record<string, { stdout: string; exitCode: number }>) {
  return async (binary: string, args: string[]) => {
    const key = `${binary} ${args.join(" ")}`;
    const result = map[key];
    if (!result) throw new Error(`unmapped invocation: ${key}`);
    return result;
  };
}

describe("detectPython", () => {
  test("returns python3 + version + both packages when python3 has all deps", async () => {
    const out = await detectPython({
      spawn: makeStubSpawn({
        "python3 --version": { stdout: "Python 3.11.4\n", exitCode: 0 },
        "python3 -c import requests": { stdout: "", exitCode: 0 },
        "python3 -c import dotenv": { stdout: "", exitCode: 0 },
      }),
    });
    expect(out.binary).toBe("python3");
    expect(out.version).toBe("3.11.4");
    expect(out.versionOk).toBe(true);
    expect(out.packagesAvailable).toEqual({ requests: true, dotenv: true });
  });

  test("falls back to 'python' binary when python3 missing", async () => {
    const out = await detectPython({
      spawn: makeStubSpawn({
        "python3 --version": { stdout: "", exitCode: 127 },
        "python --version": { stdout: "Python 3.10.5\n", exitCode: 0 },
        "python -c import requests": { stdout: "", exitCode: 0 },
        "python -c import dotenv": { stdout: "", exitCode: 1 },
      }),
    });
    expect(out.binary).toBe("python");
    expect(out.version).toBe("3.10.5");
    expect(out.packagesAvailable.dotenv).toBe(false);
  });

  test("returns null binary when neither python3 nor python is found", async () => {
    const out = await detectPython({
      spawn: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(out.binary).toBeNull();
    expect(out.version).toBeNull();
    expect(out.versionOk).toBe(false);
  });

  test("rejects Python 2 (version < 3.8)", async () => {
    const out = await detectPython({
      spawn: makeStubSpawn({
        "python3 --version": { stdout: "", exitCode: 127 },
        "python --version": { stdout: "Python 2.7.18\n", exitCode: 0 },
      }),
    });
    expect(out.binary).toBeNull();
  });

  test("rejects Python 3.6 (below the 3.8 floor)", async () => {
    const out = await detectPython({
      spawn: makeStubSpawn({
        "python3 --version": { stdout: "Python 3.6.9\n", exitCode: 0 },
        "python --version": { stdout: "", exitCode: 127 },
      }),
    });
    expect(out.binary).toBeNull();
  });

  test("packages-missing case: binary OK, packages not importable", async () => {
    const out = await detectPython({
      spawn: makeStubSpawn({
        "python3 --version": { stdout: "Python 3.11.4\n", exitCode: 0 },
        "python3 -c import requests": { stdout: "", exitCode: 1 },
        "python3 -c import dotenv": { stdout: "", exitCode: 1 },
      }),
    });
    expect(out.binary).toBe("python3");
    expect(out.versionOk).toBe(true);
    expect(out.packagesAvailable.requests).toBe(false);
    expect(out.packagesAvailable.dotenv).toBe(false);
  });
});

describe("pythonNotInstalledRemediation", () => {
  test("includes python.org and version requirement", () => {
    const msg = pythonNotInstalledRemediation();
    expect(msg).toContain("python.org");
    expect(msg).toContain("3.8");
    expect(msg).toContain("python3 --version");
  });
});
