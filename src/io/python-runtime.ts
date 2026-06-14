// src/io/python-runtime.ts
//
// Detect Python availability for the atlassian-skills runtime requirement.
// Atlassian-skills are pure Python (langpingxue/atlassian-skills) — they
// require Python 3.8+ and the `requests` + `python-dotenv` packages.
//
// Test seam: deps.spawn lets tests stub the subprocess invocation.

import { spawn } from "node:child_process";

export interface PythonRuntimeStatus {
  /** Resolved Python binary name on PATH, or null if neither found. */
  binary: "python3" | "python" | null;
  /** Version string from `<binary> --version`, e.g. "3.11.4", or null. */
  version: string | null;
  /** True if the version satisfies `>= 3.8`. */
  versionOk: boolean;
  /** Whether each required package is importable via `<binary> -c "import X"`. */
  packagesAvailable: { requests: boolean; dotenv: boolean };
}

export interface DetectPythonDeps {
  spawn?: (binary: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function detectPython(deps: DetectPythonDeps = {}): Promise<PythonRuntimeStatus> {
  const spawnFn = deps.spawn ?? defaultSpawn;
  for (const candidate of ["python3", "python"] as const) {
    const versionResult = await spawnFn(candidate, ["--version"]).catch(() => null);
    if (!versionResult || versionResult.exitCode !== 0) continue;
    const versionLine = versionResult.stdout.trim();
    const match = versionLine.match(/Python (\d+)\.(\d+)\.(\d+)/);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const versionOk = major >= 3 && (major > 3 || minor >= 8);
    if (!versionOk) continue;
    const requests = await checkPackage(spawnFn, candidate, "requests");
    const dotenv = await checkPackage(spawnFn, candidate, "dotenv");
    return {
      binary: candidate,
      version: `${match[1]}.${match[2]}.${match[3]}`,
      versionOk: true,
      packagesAvailable: { requests, dotenv },
    };
  }
  return {
    binary: null,
    version: null,
    versionOk: false,
    packagesAvailable: { requests: false, dotenv: false },
  };
}

async function checkPackage(
  spawnFn: NonNullable<DetectPythonDeps["spawn"]>,
  binary: string,
  pkg: string,
): Promise<boolean> {
  const result = await spawnFn(binary, ["-c", `import ${pkg}`]).catch(() => null);
  return result !== null && result.exitCode === 0;
}

/** Default per-invocation timeout for {@link defaultSpawn}, in milliseconds. */
export const DEFAULT_SPAWN_TIMEOUT_MS = 4000;

/**
 * Spawn a child process, capture its stdout, and resolve when it exits.
 *
 * A bounded timeout (default {@link DEFAULT_SPAWN_TIMEOUT_MS}) guards against a
 * wedged interpreter hanging `smith doctor` indefinitely: if the child does not
 * exit in time it is killed and the call resolves as a failure (non-zero exit,
 * empty stdout) so Python detection degrades to "unavailable" rather than
 * blocking forever. `timeoutMs` is injectable so tests can exercise the timeout
 * path quickly.
 */
export function defaultSpawn(
  binary: string,
  args: string[],
  timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      // Degrade to a failure result so detection treats this as unavailable.
      resolve({ stdout: "", exitCode: 1 });
    }, timeoutMs);
    // Don't let the timer keep the event loop alive on its own.
    timer.unref?.();

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout || stderr, exitCode: code ?? 1 });
    });
  });
}

export function pythonNotInstalledRemediation(): string {
  return (
    "Python 3.8+ is required to install atlassian-skills bundles " +
    "(the bundles are pure-Python utilities for Jira/Confluence/" +
    "Bitbucket). Install Python from https://python.org or via " +
    "your system package manager (e.g. `brew install python` on " +
    "macOS, `apt install python3` on Debian/Ubuntu). After install, " +
    "verify with: python3 --version. Then re-run the skill install."
  );
}
